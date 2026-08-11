import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getActiveProvisionBySlug,
  preflightProvision,
  startProvision,
  type TenantConfigDraft,
} from "@/lib/provisioning";
import { composeTenantPrompt, normalizeBotBehavior, type BotBehavior } from "@/lib/bot-prompts";
import {
  createSnapshot,
  loadQualityRecord,
  newQualityRecord,
  qualityGatePassed,
  saveQualityRecord,
} from "@/lib/quality-center.server";
import type { GroqKeyMode } from "@/lib/quality-center.server";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";
const DEFAULT_BRANCH = "main";

type BotType = "assistant" | "messaging" | "voice";

const DESCRIPCION_POR_COMPORTAMIENTO: Record<BotBehavior, string> = {
  sales: "Bot de ventas, agendamiento y fidelización.",
  technical_support: "Bot de soporte técnico especializado.",
  personal_assistant: "Asistente ejecutivo personal: tría el correo y libera tiempo del directivo.",
};

interface BotBuilderRequest {
  mode?: "draft" | "publish";
  clientId?: string;
  productName?: string;
  botType?: BotType;
  tenant: {
    slug?: string;
    nombre?: string;
    nombreBot?: string;
    descripcion?: string;
    direccion?: string;
    horario?: string;
    contacto?: string;
    moneda?: string;
    zonaHoraria?: string;
    schedule?: {
      businessDays?: number[];
      businessStart?: string;
      businessEnd?: string;
      quietStart?: string;
      quietEnd?: string;
      holidays?: string[];
      appointmentReminderTime?: string;
      dailyReportTime?: string;
    };
    servicios?: string[];
    behavior?: string;
    companyInfo?: string;
    extraInstructions?: string;
    cotizaPorChat?: boolean;
    googleCalendarId?: string;
    asistente?: {
      correo?: string;
      whatsappAlertas?: string;
      umbralConfianza?: number;
      intervaloMinutos?: number;
      horaReporte?: string;
      actuaComoTitular?: boolean;
      nombreTitular?: string;
      enviarAutomatico?: boolean;
      proveedor?: string;
    };
  };
  groqModel?: string;
  groqKeyMode?: GroqKeyMode;
  groqApiKey?: string;
  updateClient?: boolean;
}

export const Route = createFileRoute("/api/bot-builder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }

        let body: BotBuilderRequest;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body invalido." }, { status: 400 });
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }
        const { data: isOwner } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "owner",
        });
        if (!isOwner) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }

        const clientId = String(body.clientId ?? "");
        if (!clientId) {
          return Response.json({ error: "Debes elegir un cliente existente." }, { status: 400 });
        }
        if (!process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY) {
          return Response.json(
            {
              error:
                "Falta STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local. Agrega esta variable a .env.local y reinicia http://127.0.0.1:5173/.",
            },
            { status: 500 },
          );
        }

        const { data: client, error: clientError } = await supabaseAdmin
          .from("clients")
          .select("id,company_name,email,phone,services")
          .eq("id", clientId)
          .maybeSingle();
        if (clientError) {
          return Response.json({ error: clientError.message }, { status: 500 });
        }
        if (!client) {
          return Response.json({ error: "Cliente no encontrado." }, { status: 404 });
        }

        const slug = sanitizeSlug(body.tenant.slug || client.company_name);
        if (!slug) {
          return Response.json({ error: "No se pudo generar un slug valido." }, { status: 400 });
        }

        const behavior = normalizeBotBehavior(body.tenant.behavior);
        const botType: BotType = body.botType ?? "messaging";
        if (botType === "voice") {
          return Response.json(
            {
              error:
                "El bot de llamadas todavía está en desarrollo y no se puede publicar como si estuviera listo.",
            },
            { status: 409 },
          );
        }

        // El asistente se valida en el servidor además del formulario: sin
        // correo no hay bandeja que triar y el bot quedaría inerte.
        let asistente: TenantConfigDraft["asistente"];
        if (botType === "assistant") {
          const correo = (body.tenant.asistente?.correo ?? "").trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
            return Response.json(
              { error: "Un bot asistente necesita el correo que va a atender." },
              { status: 400 },
            );
          }
          const umbral = Number(body.tenant.asistente?.umbralConfianza);
          const intervalo = Number(body.tenant.asistente?.intervaloMinutos);
          const hora = String(body.tenant.asistente?.horaReporte ?? "");
          const proveedorPedido = body.tenant.asistente?.proveedor;
          asistente = {
            correo,
            // Gmail por defecto: es el flujo más rodado y no rompe los bots ya
            // creados, cuyo JSON no trae este campo.
            proveedor:
              proveedorPedido === "microsoft" || proveedorPedido === "imap"
                ? proveedorPedido
                : "gmail",
            whatsappAlertas: (body.tenant.asistente?.whatsappAlertas ?? "").replace(/\D/g, ""),
            // Bajo a propósito: el asistente redacta por defecto y este valor
            // solo frena los correos que de verdad no entendió.
            umbralConfianza: Number.isFinite(umbral) && umbral > 0 && umbral <= 1 ? umbral : 0.35,
            intervaloMinutos:
              Number.isFinite(intervalo) && intervalo >= 1 ? Math.min(intervalo, 1440) : 10,
            horaReporte: /^\d{2}:\d{2}$/.test(hora) ? hora : "18:00",
            // Por defecto el asistente se identifica: escribir a nombre del
            // titular es una decisión explícita del cliente, no un default.
            actuaComoTitular: body.tenant.asistente?.actuaComoTitular === true,
            nombreTitular:
              (body.tenant.asistente?.nombreTitular ?? "").trim() || client.company_name,
            // Nunca se envía automáticamente por omisión. El cliente debe
            // aprobar borradores y activarlo de forma explícita.
            enviarAutomatico: body.tenant.asistente?.enviarAutomatico === true,
          };
        }

        // Cuando el asistente actúa a nombre del titular no se presenta con un
        // nombre de bot: usa el del cliente, y por eso el formulario ni siquiera
        // pide "Bot name" en ese caso.
        const nombreBotPorDefecto = asistente?.actuaComoTitular
          ? asistente.nombreTitular
          : `${client.company_name} Bot`;

        const validTime = (value: unknown, fallback: string) =>
          /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? String(value) : fallback;
        const businessDays = Array.isArray(body.tenant.schedule?.businessDays)
          ? [...new Set(body.tenant.schedule.businessDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
          : [1, 2, 3, 4, 5];
        const holidays = Array.isArray(body.tenant.schedule?.holidays)
          ? [...new Set(body.tenant.schedule.holidays.map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
          : [];

        let tenantConfig: TenantConfigDraft = {
          slug,
          kind: botType,
          nombreBot: asistente?.actuaComoTitular
            ? nombreBotPorDefecto
            : body.tenant.nombreBot?.trim() || nombreBotPorDefecto,
          nombre: body.tenant.nombre?.trim() || client.company_name,
          descripcion: body.tenant.descripcion?.trim() || DESCRIPCION_POR_COMPORTAMIENTO[behavior],
          direccion: body.tenant.direccion?.trim() || "Atencion por WhatsApp",
          horario: body.tenant.horario?.trim() || "Lunes a viernes de 9:00 AM a 6:00 PM",
          contacto: body.tenant.contacto?.trim() || client.phone || "",
          redes: {},
          servicios: body.tenant.servicios ?? [],
          moneda: body.tenant.moneda?.trim() || "USD",
          zonaHoraria: body.tenant.zonaHoraria?.trim() || "America/Santo_Domingo",
          schedule: {
            businessDays,
            businessStart: validTime(body.tenant.schedule?.businessStart, "09:00"),
            businessEnd: validTime(body.tenant.schedule?.businessEnd, "18:00"),
            quietStart: validTime(body.tenant.schedule?.quietStart, "20:00"),
            quietEnd: validTime(body.tenant.schedule?.quietEnd, "08:00"),
            holidays,
            appointmentReminderTime: validTime(body.tenant.schedule?.appointmentReminderTime, "09:00"),
            dailyReportTime: validTime(
              body.tenant.schedule?.dailyReportTime,
              asistente?.horaReporte ?? "20:00",
            ),
          },
          // Dashboard users are created explicitly from Client Manager →
          // Access. Do not grant access implicitly from a contact email.
          adminEmails: [],
          behavior,
          companyInfo: body.tenant.companyInfo?.trim() || "",
          extraInstructions: body.tenant.extraInstructions?.trim() || "",
          promptExtra: composeTenantPrompt({
            behavior,
            companyInfo: body.tenant.companyInfo,
            extraInstructions: body.tenant.extraInstructions,
            canQuoteByChat: body.tenant.cotizaPorChat !== false,
          }),
          policy: {
            canQuoteByChat: body.tenant.cotizaPorChat !== false,
            requireAppointmentConfirmation: true,
            requireHumanForCommitments: true,
          },
          googleCalendarId: body.tenant.googleCalendarId?.trim() || "primary",
          ...(asistente ? { asistente } : {}),
        };

        try {
          new Intl.DateTimeFormat("en", { timeZone: tenantConfig.zonaHoraria }).format();
        } catch {
          return Response.json({ error: "La zona horaria no es válida." }, { status: 400 });
        }

        const activo = getActiveProvisionBySlug(slug);
        if (activo) {
          return Response.json(
            {
              ok: true,
              slug,
              tenantPath: `backend/config/tenants/${slug}.json`,
              commitUrl: null,
              deployTriggered: false,
              job: activo,
              botStatusUrl: activo.botStatusUrl,
              dashboardUrl: activo.dashboardUrl,
            },
            { status: 202 },
          );
        }

        const { data: botExistente, error: botExistenteError } = await supabaseAdmin
          .from("client_bots")
          .select("client_id,status")
          .eq("slug", slug)
          .maybeSingle();
        if (botExistenteError) {
          return Response.json(
            { error: `No se pudo validar el slug: ${botExistenteError.message}` },
            { status: 500 },
          );
        }
        if (botExistente?.status === "active" && body.mode !== "publish") {
          return Response.json(
            {
              error:
                "Ese slug ya pertenece a un bot activo. Edítalo desde Client Manager en vez de crear otro.",
            },
            { status: 409 },
          );
        }
        if (botExistente && botExistente.client_id !== clientId) {
          return Response.json(
            { error: "Ese slug ya está reservado por otro cliente." },
            { status: 409 },
          );
        }

        let groqModel = ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "openai/gpt-oss-20b"].includes(
          body.groqModel?.trim() ?? "",
        )
          ? body.groqModel!.trim()
          : "openai/gpt-oss-120b";
        const groqKeyMode: GroqKeyMode =
          body.groqKeyMode === "dedicated" ? "dedicated" : "automatic";

        if (body.mode !== "publish") {
          try {
            const previous = await loadQualityRecord(slug);
            const record = newQualityRecord({
              slug,
              clientId,
              clientName: client.company_name,
              productName: body.productName ?? null,
              botType,
              groqModel,
              groqKeyMode,
              updateClient: body.updateClient === true,
              tenantConfig,
            });
            if (previous && previous.state !== "active") {
              record.createdAt = previous.createdAt;
            }
            await saveQualityRecord(record, `Guardar borrador de calidad ${slug}`);
            return Response.json(
              {
                ok: true,
                draft: true,
                slug,
                qualityUrl: `/quality-center?slug=${encodeURIComponent(slug)}`,
                message:
                  "Borrador guardado. Debe superar el Centro de Calidad antes de publicarse.",
              },
              { status: 201 },
            );
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "No se pudo guardar el borrador." },
              { status: 500 },
            );
          }
        }

        const quality = await loadQualityRecord(slug).catch(() => null);
        if (!quality || quality.clientId !== clientId) {
          return Response.json(
            { error: "Este bot no tiene un borrador válido en el Centro de Calidad." },
            { status: 409 },
          );
        }
        if (!qualityGatePassed(quality)) {
          return Response.json(
            {
              error:
                "El bot debe aprobar pruebas, infraestructura y revisión manual antes de publicarse.",
            },
            { status: 409 },
          );
        }
        // La configuración aprobada es la única que se publica. El cuerpo de
        // la solicitud no puede sustituir silenciosamente lo que se probó.
        tenantConfig = quality.tenantConfig;
        groqModel = quality.groqModel || "openai/gpt-oss-120b";
        const approvedKeyMode = quality.groqKeyMode ?? "automatic";
        if (approvedKeyMode === "dedicated" && !body.groqApiKey?.trim()) {
          return Response.json(
            { error: "Este bot requiere una clave Groq dedicada. Introdúcela para publicar." },
            { status: 400 },
          );
        }

        try {
          await preflightProvision(body.groqApiKey?.trim(), asistente?.proveedor);
        } catch (error) {
          return Response.json(
            {
              error: `No se inició la creación porque la infraestructura no está lista: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
            { status: 503 },
          );
        }

        const githubToken = process.env.STAGE_GITHUB_TOKEN;
        if (!githubToken) {
          return Response.json(
            {
              error:
                "Falta STAGE_GITHUB_TOKEN en tu entorno local para poder guardar el tenant en GitHub.",
            },
            { status: 500 },
          );
        }

        const repo = process.env.STAGE_BOT_TEMPLATE_REPO || DEFAULT_REPO;
        const branch = process.env.STAGE_BOT_TEMPLATE_BRANCH || DEFAULT_BRANCH;
        const [owner, name] = repo.split("/");
        if (!owner || !name) {
          return Response.json(
            { error: "STAGE_BOT_TEMPLATE_REPO debe tener formato owner/repo." },
            { status: 500 },
          );
        }

        const tenantPath = `backend/config/tenants/${slug}.json`;
        const json = `${JSON.stringify(tenantConfig, null, 2)}\n`;

        const createdFile = await putGithubFile({
          owner,
          repo: name,
          path: tenantPath,
          branch,
          token: githubToken,
          content: json,
          message: `Agregar tenant ${tenantConfig.nombre}`,
        });
        if (!createdFile.ok) {
          return Response.json({ error: createdFile.error }, { status: createdFile.status });
        }

        await createSnapshot(
          slug,
          "version",
          tenantConfig,
          "Configuración aprobada antes de publicar",
        );

        if (body.updateClient) {
          const currentServices = Array.isArray(client.services) ? client.services : [];
          const nextServices =
            body.productName && !currentServices.includes(body.productName)
              ? [...currentServices, body.productName]
              : currentServices;
          await supabaseAdmin
            .from("clients")
            .update({
              services: nextServices,
            })
            .eq("id", clientId);
        }

        const job = startProvision({
          clientId,
          clientName: client.company_name,
          slug,
          kind: botType,
          productName: body.productName ?? null,
          tenantConfig,
          githubCommitUrl: createdFile.commitUrl,
          groqModel,
          groqApiKey: body.groqApiKey?.trim(),
        });

        quality.state = "publishing";
        quality.provisionJobId = job.id;
        quality.lastError = null;
        await saveQualityRecord(quality, `Iniciar publicación aprobada de ${slug}`);

        return Response.json(
          {
            ok: true,
            slug,
            tenantPath,
            commitUrl: createdFile.commitUrl,
            // El JSON queda versionado en GitHub. El job local crea y despliega
            // su app dedicada; así un bot nuevo nunca reinicia una app ajena.
            deployTriggered: false,
            job,
            botStatusUrl: job.botStatusUrl,
            dashboardUrl: job.dashboardUrl,
          },
          { status: 202 },
        );
      },
    },
  },
});

async function putGithubFile(args: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
  content: string;
  message: string;
}): Promise<{ ok: true; commitUrl: string | null } | { ok: false; error: string; status: number }> {
  const base = `https://api.github.com/repos/${args.owner}/${args.repo}/contents/${args.path}`;
  const existingRes = await fetch(`${base}?ref=${encodeURIComponent(args.branch)}`, {
    headers: githubHeaders(args.token),
  });
  let sha: string | undefined;
  if (existingRes.ok) {
    const existing = await existingRes.json();
    sha = typeof existing.sha === "string" ? existing.sha : undefined;
  } else if (existingRes.status !== 404) {
    return {
      ok: false,
      status: existingRes.status,
      error: `GitHub no pudo revisar si el archivo existe (${existingRes.status}).`,
    };
  }

  const res = await fetch(base, {
    method: "PUT",
    headers: githubHeaders(args.token),
    body: JSON.stringify({
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: args.branch,
      sha,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.message ?? `GitHub respondio ${res.status}.`,
    };
  }
  return { ok: true, commitUrl: payload?.commit?.html_url ?? null };
}

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "stage-ai-labs-owner-console",
  };
}

function sanitizeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

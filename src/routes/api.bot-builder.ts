import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startProvision } from "@/lib/provisioning";
import { composeTenantPrompt, normalizeBotBehavior } from "@/lib/bot-prompts";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";
const DEFAULT_BRANCH = "main";
const LOCAL_CLIENT_DASHBOARD_URL = "http://127.0.0.1:5174/";

type BotType = "assistant" | "messaging" | "voice";

interface BotBuilderRequest {
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
    servicios?: string[];
    behavior?: string;
    companyInfo?: string;
    extraInstructions?: string;
    googleCalendarId?: string;
  };
  groqModel?: string;
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
            { error: "Falta STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local. Agrega esta variable a .env.local y reinicia http://127.0.0.1:5173/." },
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

        const tenantConfig = {
          slug,
          nombreBot: body.tenant.nombreBot?.trim() || `${client.company_name} Bot`,
          nombre: body.tenant.nombre?.trim() || client.company_name,
          descripcion: body.tenant.descripcion?.trim() || (behavior === "technical_support" ? "Bot de soporte técnico especializado." : "Bot de ventas, agendamiento y fidelización."),
          direccion: body.tenant.direccion?.trim() || "Atencion por WhatsApp",
          horario: body.tenant.horario?.trim() || "Lunes a viernes de 9:00 AM a 6:00 PM",
          contacto: body.tenant.contacto?.trim() || client.phone || "",
          redes: {},
          servicios: body.tenant.servicios ?? [],
          moneda: body.tenant.moneda?.trim() || "USD",
          zonaHoraria: body.tenant.zonaHoraria?.trim() || "America/Santo_Domingo",
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
          }),
          googleCalendarId: body.tenant.googleCalendarId?.trim() || "primary",
        };

        const githubToken = process.env.STAGE_GITHUB_TOKEN;
        if (!githubToken) {
          return Response.json(
            { error: "Falta STAGE_GITHUB_TOKEN en tu entorno local para poder guardar el tenant en GitHub." },
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

        const dashboardBaseUrl = process.env.STAGE_CLIENT_DASHBOARD_URL || LOCAL_CLIENT_DASHBOARD_URL;
        const dashboardUrl = `${dashboardBaseUrl.replace(/\/$/, "")}/?tenant=${encodeURIComponent(slug)}`;

        if (body.updateClient) {
          const currentServices = Array.isArray(client.services) ? client.services : [];
          const nextServices = body.productName && !currentServices.includes(body.productName)
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
          kind: body.botType ?? "messaging",
          productName: body.productName ?? null,
          tenantConfig,
          githubCommitUrl: createdFile.commitUrl,
          dashboardUrl,
          groqModel: body.groqModel?.trim() || "meta-llama/llama-4-scout-17b-16e-instruct",
          groqApiKey: body.groqApiKey?.trim(),
        });

        return Response.json({
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
        }, { status: 202 });
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

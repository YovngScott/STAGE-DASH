import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inspectProvisionPreflight, redeployBotConfig, type BotKind } from "@/lib/provisioning";
import {
  createSnapshot,
  listQualityRecords,
  listSnapshots,
  loadQualityRecord,
  loadSnapshot,
  mandatoryTestsPassed,
  preflightPassed,
  qualityGatePassed,
  newQualityRecord,
  readPublishedTenant,
  saveQualityRecord,
  validateSnapshot,
  writePublishedTenant,
  deleteBotAndCleanup,
} from "@/lib/quality-center.server";
import { runMandatoryQualityTests, runManualQualityTest } from "@/lib/quality-engine.server";

type ActionBody = {
  action?:
    | "manual_test"
    | "automatic_tests"
    | "manual_approval"
    | "prepare_publish"
    | "backup"
    | "restore_drill"
    | "rollback"
    | "restore_backup"
    | "delete_bot"
    | "update_knowledge_base";
  slug?: string;
  question?: string;
  snapshotId?: string;
  knowledgeBase?: {
    sourceUrl?: string;
    sourceName?: string;
    content?: string;
  };
};

async function getOrCreateQualityRecord(slugOrId: string) {
  const clean = slugOrId.trim();
  if (!clean) return null;

  // 1. Intentar cargar registro existente de calidad desde GitHub
  let record = await loadQualityRecord(clean).catch(() => null);
  if (record) return record;

  // 2. Buscar en Supabase client_bots por slug o por id (UUID)
  const { data: bot } = await supabaseAdmin
    .from("client_bots")
    .select("id,slug,name,kind,status,client_id,product_name")
    .or(`slug.eq.${clean},id.eq.${clean}`)
    .maybeSingle();

  if (!bot) return null;

  const actualSlug = bot.slug || clean;
  if (actualSlug !== clean) {
    record = await loadQualityRecord(actualSlug).catch(() => null);
    if (record) return record;
  }

  // 3. Buscar configuración del tenant en GitHub o en disco local
  let tenant = await readPublishedTenant(actualSlug);

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("company_name,phone,email,notes,services,mrr")
    .eq("id", bot.client_id)
    .maybeSingle();

  // 4. Si el tenant aún no existe en GitHub ni en disco, sintetizar configuración base desde DB
  if (!tenant) {
    const companyName = client?.company_name || bot.name || actualSlug;
    const phone = client?.phone || "";
    const cleanPhone = phone.replace(/[^\d+]/g, "");
    const phoneDigits = cleanPhone.replace(/^\+/, "");
    const kind = (bot.kind || "messaging") as "assistant" | "messaging" | "voice";

    tenant = {
      slug: actualSlug,
      kind,
      nombreBot: bot.name || `Asistente de ${companyName}`,
      nombre: companyName,
      descripcion: `Asistente virtual y atención automatizada vía WhatsApp para ${companyName}.`,
      direccion: "Atención remota / República Dominicana",
      horario: "Lunes a viernes, 09:00–18:00",
      contacto: cleanPhone ? (cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`) : "",
      whatsappJid: phoneDigits ? `${phoneDigits}@s.whatsapp.net` : "",
      redes: "",
      servicios: Array.isArray(client?.services)
        ? client.services.join(", ")
        : `Servicios oficiales de ${companyName}`,
      moneda: "USD",
      zonaHoraria: "America/Santo_Domingo",
      preferredModel: {
        provider: "gemini",
        modelName: "gemini-flash-latest",
      },
      whatsapp: {
        provider: "baileys",
        phoneNumberId: "",
        businessAccountId: "",
        apiVersion: "v23.0",
      },
      schedule: {
        businessDays: [1, 2, 3, 4, 5],
        businessStart: "09:00",
        businessEnd: "18:00",
        quietStart: "20:00",
        quietEnd: "08:00",
        holidays: [],
        appointmentReminderTime: "09:00",
        dailyReportTime: "18:00",
      },
      adminEmails: client?.email ? [client.email] : ["owner@stagelabs.com"],
      behavior: "sales",
      policy: {
        canQuoteByChat: false,
        requireAppointmentConfirmation: true,
        requireHumanForCommitments: true,
      },
      companyInfo: client?.notes || `Información de operaciones y servicios de ${companyName}.`,
      extraInstructions:
        "Responde siempre de forma cordial, concisa y profesional. Si el cliente solicita información no confirmada, escala amablemente la conversación a un agente humano.",
      promptExtra: "",
      googleCalendarId: "primary",
      insuranceAutomationEnabled: false,
      knowledgeBase: {
        sourceName: `Base de Conocimiento - ${companyName}`,
        content: "",
        lastSyncedAt: new Date().toISOString(),
      },
      asistente:
        kind === "assistant"
          ? {
              correo: `info@${actualSlug}.com`,
              proveedor: "gmail",
              whatsappAlertas: phoneDigits,
              umbralConfianza: 0.35,
              horaReporte: "18:00",
              intervaloMinutos: 10,
              maxPorCorrida: 25,
              actuaComoTitular: false,
              nombreTitular: companyName,
              enviarAutomatico: false,
              categorias: {
                Ventas: "Consultas comerciales y cotizaciones",
                Soporte: "Dudas y asistencia técnica",
                General: "Asuntos administrativos de rutina",
              },
            }
          : null,
    };

    try {
      await writePublishedTenant(
        actualSlug,
        tenant,
        `Crear configuración inicial de tenant para ${actualSlug}`,
      );
    } catch (writeTenantErr) {
      console.warn(
        `[Quality Center] Aviso: No se pudo escribir tenant en GitHub (${writeTenantErr instanceof Error ? writeTenantErr.message : String(writeTenantErr)})`,
      );
    }
  }

  record = newQualityRecord({
    slug: actualSlug,
    clientId: bot.client_id,
    clientName: client?.company_name ?? tenant.nombre ?? actualSlug,
    productName: bot.product_name ?? null,
    botType: (bot.kind ?? tenant.kind ?? "messaging") as
      "assistant" | "messaging" | "voice",
    groqModel: "openai/gpt-oss-120b",
    updateClient: false,
    tenantConfig: tenant,
  });
  record.state = bot.status === "active" ? "active" : "draft";
  record.publishedAt = bot.status === "active" ? new Date().toISOString() : null;

  try {
    await saveQualityRecord(record, `Importar ${actualSlug} al Centro de Calidad`);
  } catch (saveRecErr) {
    console.warn(
      `[Quality Center] Aviso: No se pudo guardar registro de calidad en GitHub (${saveRecErr instanceof Error ? saveRecErr.message : String(saveRecErr)})`,
    );
  }

  return record;
}

export const Route = createFileRoute("/api/quality-center")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        const rawParam =
          new URL(request.url).searchParams.get("slug")?.trim() ||
          new URL(request.url).searchParams.get("id")?.trim() ||
          new URL(request.url).searchParams.get("botId")?.trim();
        try {
          if (rawParam) {
            const record = await getOrCreateQualityRecord(rawParam);
            if (!record) {
              return Response.json({ error: "Bot no encontrado." }, { status: 404 });
            }

            const targetSlug = record.slug;
            const [versions, backups] = await Promise.all([
              listSnapshots(targetSlug, "version").catch(() => []),
              listSnapshots(targetSlug, "backup").catch(() => []),
            ]);
            return Response.json({
              record,
              versions: versions ?? [],
              backups: backups ?? [],
              canPublish: qualityGatePassed(record),
            });
          }

          const records = await listQualityRecords().catch(() => []);
          const { data: bots } = await supabaseAdmin
            .from("client_bots")
            .select("id,name,slug,kind,status,client_id,bot_status_url")
            .order("name");
          return Response.json({ records, bots: bots ?? [] });
        } catch (error) {
          return Response.json({ error: message(error) }, { status: 502 });
        }
      },

      POST: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => null)) as ActionBody | null;
        const slug = body?.slug?.trim() ?? "";
        if (!body?.action || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
          return Response.json({ error: "Solicitud de calidad inválida." }, { status: 400 });
        }
        try {
          if (body.action === "delete_bot") {
            const result = await deleteBotAndCleanup(slug);
            return Response.json({ ok: true, ...result });
          }

          let record = await loadQualityRecord(slug).catch(() => null);
          if (!record) {
            record = await getOrCreateQualityRecord(slug);
          }
          if (!record) return Response.json({ error: "Borrador no encontrado." }, { status: 404 });

          if (body.action === "manual_test") {
            const question = body.question?.trim() ?? "";
            if (question.length < 2 || question.length > 2000) {
              return Response.json(
                { error: "Escribe una pregunta de hasta 2,000 caracteres." },
                { status: 400 },
              );
            }
            const run = await runManualQualityTest(record, question);
            record.manualRuns = [run, ...record.manualRuns].slice(0, 20);
            await saveQualityRecord(record, `Prueba manual de ${slug}`);
            return Response.json({ ok: true, run });
          }

          if (body.action === "update_knowledge_base") {
            const kb = body.knowledgeBase ?? {};
            record.tenantConfig.knowledgeBase = {
              sourceUrl: kb.sourceUrl?.trim() || undefined,
              sourceName: kb.sourceName?.trim() || undefined,
              content: kb.content?.trim() || undefined,
              lastSyncedAt: new Date().toISOString(),
            };
            await saveQualityRecord(record, `Actualizar base de conocimiento de ${slug}`);

            const published = await readPublishedTenant(slug);
            if (published) {
              published.knowledgeBase = record.tenantConfig.knowledgeBase;
              await writePublishedTenant(
                slug,
                published,
                `Actualizar base de conocimiento de ${slug}`,
              );

              const { data: bot } = await supabaseAdmin
                .from("client_bots")
                .select("kind,bot_status_url,status")
                .eq("slug", slug)
                .maybeSingle();
              if (bot?.status === "active") {
                const appName = appNameFromStatusUrl(bot.bot_status_url);
                if (appName) {
                  await redeployBotConfig({
                    appName,
                    slug,
                    kind: (bot.kind ?? record.botType) as BotKind,
                    tenantConfig: published,
                  });
                }
              }
            }

            return Response.json({ ok: true, record });
          }

          if (body.action === "automatic_tests") {
            record.tests = await runMandatoryQualityTests(record);
            record.preflightChecks = await inspectProvisionPreflight(
              undefined,
              record.tenantConfig.asistente?.proveedor,
            );
            record.preflightAt = new Date().toISOString();
            record.manualApprovedAt = null;
            const automatedPassed = mandatoryTestsPassed(record) && preflightPassed(record);
            record.state = "draft";
            record.lastError = automatedPassed
              ? null
              : "Una o más pruebas o comprobaciones de infraestructura fallaron.";
            await saveQualityRecord(record, `Pruebas obligatorias de ${slug}`);
            return Response.json({
              ok: true,
              record,
              automatedPassed,
              canPublish: qualityGatePassed(record),
            });
          }

          if (body.action === "manual_approval") {
            if (!mandatoryTestsPassed(record) || !preflightPassed(record)) {
              return Response.json(
                { error: "Completa primero la validación automática." },
                { status: 409 },
              );
            }
            if (!record.manualRuns.length) {
              return Response.json(
                { error: "Ejecuta al menos una conversación manual antes de aprobar." },
                { status: 409 },
              );
            }
            record.manualApprovedAt = new Date().toISOString();
            record.state = "ready";
            record.lastError = null;
            await saveQualityRecord(record, `Aprobar revisión manual de ${slug}`);
            return Response.json({ ok: true, record, canPublish: true });
          }

          if (body.action === "prepare_publish") {
            if (!qualityGatePassed(record)) {
              return Response.json(
                {
                  error:
                    "El bot necesita pruebas, infraestructura y aprobación manual antes de publicarse.",
                },
                { status: 409 },
              );
            }
            return Response.json({
              ok: true,
              request: {
                mode: "publish",
                clientId: record.clientId,
                productName: record.productName,
                botType: record.botType,
                tenant: record.tenantConfig,
                groqModel: record.groqModel,
                groqKeyMode: record.groqKeyMode ?? "automatic",
                updateClient: record.updateClient,
              },
            });
          }

          if (body.action === "backup") {
            const published = await readPublishedTenant(slug);
            const snapshot = await createSnapshot(
              slug,
              "backup",
              published ?? record.tenantConfig,
              "Backup manual verificado",
            );
            return Response.json({ ok: true, snapshot });
          }

          if (body.action === "restore_drill") {
            const backups = await listSnapshots(slug, "backup");
            const latest = backups[0];
            if (!latest)
              return Response.json({ error: "Primero crea al menos un backup." }, { status: 409 });
            const validation = validateSnapshot(latest);
            record.lastRestoreDrillAt = new Date().toISOString();
            record.lastRestoreDrillOk = validation.ok;
            await saveQualityRecord(record, `Simulacro de restauración de ${slug}`);
            return Response.json({ ok: validation.ok, validation, snapshot: latest });
          }

          const kind = body.action === "rollback" ? "version" : "backup";
          const snapshot = await loadSnapshot(slug, kind, body.snapshotId ?? "");
          if (!snapshot) return Response.json({ error: "Versión no encontrada." }, { status: 404 });
          const validation = validateSnapshot(snapshot);
          if (!validation.ok)
            return Response.json(
              { error: "La copia falló la validación de integridad." },
              { status: 409 },
            );
          const current = await readPublishedTenant(slug);
          if (current)
            await createSnapshot(slug, "version", current, "Punto de retorno previo a restaurar");
          await writePublishedTenant(
            slug,
            snapshot.tenantConfig,
            `Restaurar ${slug} a ${snapshot.id}`,
          );

          const { data: bot } = await supabaseAdmin
            .from("client_bots")
            .select("kind,bot_status_url,status")
            .eq("slug", slug)
            .maybeSingle();
          if (bot?.status === "active") {
            const appName = appNameFromStatusUrl(bot.bot_status_url);
            if (!appName) throw new Error("El bot activo no tiene una URL válida de Fly.");
            await redeployBotConfig({
              appName,
              slug,
              kind: (bot.kind ?? record.botType) as BotKind,
              tenantConfig: snapshot.tenantConfig,
            });
          }
          record.tenantConfig = snapshot.tenantConfig;
          record.tests = [];
          record.state = bot?.status === "active" ? "active" : "draft";
          await saveQualityRecord(record, `Registrar restauración de ${slug}`);
          return Response.json({ ok: true, record });
        } catch (error) {
          return Response.json({ error: message(error) }, { status: 502 });
        }
      },

      DELETE: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
        if (!slug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
          return Response.json({ error: "Slug de bot inválido." }, { status: 400 });
        }
        try {
          const result = await deleteBotAndCleanup(slug);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          return Response.json({ error: message(error) }, { status: 502 });
        }
      },
    },
  },
});

async function authorizeOwner(request: Request): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: owner } = await supabase.rpc("has_role", {
    _user_id: user.user.id,
    _role: "owner",
  });
  return owner ? null : Response.json({ error: "No autorizado." }, { status: 401 });
}

function appNameFromStatusUrl(value: string | null | undefined) {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    if (!host.endsWith(".fly.dev")) return null;
    const name = host.slice(0, -8);
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

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
    | "restore_backup";
  slug?: string;
  question?: string;
  snapshotId?: string;
};

export const Route = createFileRoute("/api/quality-center")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        const slug = new URL(request.url).searchParams.get("slug")?.trim();
        try {
          if (slug) {
            let record = await loadQualityRecord(slug);
            if (!record) {
              const { data: bot } = await supabaseAdmin
                .from("client_bots")
                .select("slug,kind,status,client_id,product_name")
                .eq("slug", slug)
                .maybeSingle();
              const tenant = bot ? await readPublishedTenant(slug) : null;
              if (!bot || !tenant)
                return Response.json({ error: "Bot no encontrado." }, { status: 404 });
              const { data: client } = await supabaseAdmin
                .from("clients")
                .select("company_name")
                .eq("id", bot.client_id)
                .maybeSingle();
              record = newQualityRecord({
                slug,
                clientId: bot.client_id,
                clientName: client?.company_name ?? tenant.nombre,
                productName: bot.product_name ?? null,
                botType: (bot.kind ?? tenant.kind ?? "messaging") as
                  "assistant" | "messaging" | "voice",
                groqModel: "llama-3.3-70b-versatile",
                updateClient: false,
                tenantConfig: tenant,
              });
              record.state = bot.status === "active" ? "active" : "draft";
              record.publishedAt = bot.status === "active" ? new Date().toISOString() : null;
              await saveQualityRecord(record, `Importar ${slug} al Centro de Calidad`);
            }
            const [versions, backups] = await Promise.all([
              listSnapshots(slug, "version"),
              listSnapshots(slug, "backup"),
            ]);
            return Response.json({
              record,
              versions,
              backups,
              canPublish: qualityGatePassed(record),
            });
          }

          const records = await listQualityRecords();
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
          const record = await loadQualityRecord(slug);
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

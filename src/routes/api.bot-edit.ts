import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redeployBotConfig, type BotKind, type TenantConfigDraft } from "@/lib/provisioning";
import { composeTenantPrompt, normalizeBotBehavior, type BotBehavior } from "@/lib/bot-prompts";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";

type BotRow = {
  id: string;
  name: string;
  slug: string;
  kind: string | null;
  bot_status_url: string | null;
  bot_secret: string | null;
};

type EditBody = {
  botId?: string;
  name?: string;
  behavior?: BotBehavior;
  companyInfo?: string;
  extraInstructions?: string;
  asistente?: {
    intervaloMinutos?: number;
    horaReporte?: string;
    enviarAutomatico?: boolean;
    actuaComoTitular?: boolean;
    nombreTitular?: string;
  };
};

export const Route = createFileRoute("/api/bot-edit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;

        const botId = new URL(request.url).searchParams.get("botId");
        if (!botId) return Response.json({ error: "Falta botId." }, { status: 400 });
        const botResult = await readBot(botId);
        if (botResult instanceof Response) return botResult;

        const github = githubContext(botResult.slug);
        if (github instanceof Response) return github;
        const current = await readTenant(github.base, github.headers);
        if (current instanceof Response) return current;
        const config = current.config;
        const behavior = normalizeBotBehavior(config.behavior);

        return Response.json({
          bot: {
            id: botResult.id,
            kind: config.kind ?? botResult.kind ?? "messaging",
            name: config.nombreBot ?? botResult.name,
          },
          config: {
            behavior,
            companyInfo: String(config.companyInfo ?? ""),
            extraInstructions: String(config.extraInstructions ?? ""),
            effectivePrompt: String(config.promptExtra ?? composeTenantPrompt({ behavior })),
            asistente: config.asistente ?? null,
          },
        });
      },

      POST: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => null)) as EditBody | null;
        if (!body?.botId) return Response.json({ error: "Falta botId." }, { status: 400 });

        const botResult = await readBot(body.botId);
        if (botResult instanceof Response) return botResult;
        const github = githubContext(botResult.slug);
        if (github instanceof Response) return github;
        const current = await readTenant(github.base, github.headers);
        if (current instanceof Response) return current;

        const config = current.config;
        const name = String(body.name ?? "").trim();
        if (!name) return Response.json({ error: "El nombre del bot es obligatorio." }, { status: 400 });
        const behavior = normalizeBotBehavior(body.behavior ?? config.behavior);
        const companyInfo = String(body.companyInfo ?? "").trim();
        const extraInstructions = String(body.extraInstructions ?? "").trim();
        const kind = (config.kind ?? botResult.kind ?? "messaging") as BotKind;

        config.nombreBot = name;
        config.kind = kind;
        config.behavior = behavior;
        config.companyInfo = companyInfo;
        config.extraInstructions = extraInstructions;
        config.promptExtra = composeTenantPrompt({ behavior, companyInfo, extraInstructions });

        if (kind === "assistant") {
          if (!config.asistente) {
            return Response.json({ error: "Este asistente no tiene configuración de correo." }, { status: 400 });
          }
          const interval = Number(body.asistente?.intervaloMinutos);
          const reportTime = String(body.asistente?.horaReporte ?? "");
          const ownerName = String(body.asistente?.nombreTitular ?? "").trim();
          if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
            return Response.json({ error: "El intervalo debe ser un número entero entre 1 y 1440 minutos." }, { status: 400 });
          }
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reportTime)) {
            return Response.json({ error: "La hora del reporte debe tener formato HH:mm." }, { status: 400 });
          }
          if (body.asistente?.actuaComoTitular && !ownerName) {
            return Response.json({ error: "Indica el nombre con el que firmará el asistente." }, { status: 400 });
          }
          config.asistente = {
            ...config.asistente,
            intervaloMinutos: interval,
            horaReporte: reportTime,
            enviarAutomatico: Boolean(body.asistente?.enviarAutomatico),
            actuaComoTitular: Boolean(body.asistente?.actuaComoTitular),
            nombreTitular: ownerName,
          };
        }

        const saved = await fetch(github.base, {
          method: "PUT",
          headers: github.headers,
          body: JSON.stringify({
            message: `Actualizar configuración de ${name}`,
            content: Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8").toString("base64"),
            branch: "main",
            sha: current.sha,
          }),
        });
        const payload = await saved.json().catch(() => null);
        if (!saved.ok) {
          return Response.json({ error: payload?.message ?? `GitHub respondió ${saved.status}.` }, { status: 502 });
        }

        const { error: dbError } = await supabaseAdmin.from("client_bots").update({ name }).eq("id", botResult.id);
        if (dbError) {
          return Response.json({
            error: `La configuración quedó guardada en GitHub, pero no se pudo actualizar el nombre en Stage: ${dbError.message}`,
            commitUrl: payload?.commit?.html_url ?? null,
          }, { status: 502 });
        }

        const appName = appNameFromStatusUrl(botResult.bot_status_url);
        if (!appName) return Response.json({ error: "El bot no tiene una URL de Fly válida para aplicar el cambio." }, { status: 400 });
        try {
          await redeployBotConfig({
            appName,
            slug: botResult.slug,
            kind,
            tenantConfig: config as TenantConfigDraft,
          });
          if (kind === "assistant") {
            await updateAutomaticSending(botResult, Boolean(config.asistente?.enviarAutomatico));
          }
        } catch (error) {
          return Response.json({
            error: `El cambio quedó guardado en GitHub, pero no se pudo aplicar completamente en Fly: ${error instanceof Error ? error.message : "error desconocido"}`,
            commitUrl: payload?.commit?.html_url ?? null,
          }, { status: 502 });
        }
        return Response.json({
          ok: true,
          effectivePrompt: config.promptExtra,
          commitUrl: payload?.commit?.html_url ?? null,
        });
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
  const { data: owner } = await supabase.rpc("has_role", { _user_id: user.user.id, _role: "owner" });
  return owner ? null : Response.json({ error: "No autorizado." }, { status: 401 });
}

async function readBot(botId: string): Promise<BotRow | Response> {
  const { data, error } = await supabaseAdmin
    .from("client_bots")
    .select("id,name,slug,kind,bot_status_url,bot_secret")
    .eq("id", botId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Bot no encontrado." }, { status: 404 });
  return data as BotRow;
}

function githubContext(slug: string) {
  const token = process.env.STAGE_GITHUB_TOKEN;
  if (!token) return Response.json({ error: "Falta STAGE_GITHUB_TOKEN en Fly." }, { status: 500 });
  const [owner, repo] = (process.env.STAGE_BOT_TEMPLATE_REPO || DEFAULT_REPO).split("/");
  const path = `backend/config/tenants/${slug}.json`;
  return {
    base: `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "stage-ai-labs-owner-console",
    },
  };
}

async function readTenant(base: string, headers: Record<string, string>) {
  const response = await fetch(`${base}?ref=main`, { headers });
  if (!response.ok) return Response.json({ error: `GitHub no encontró el tenant (${response.status}).` }, { status: 502 });
  const file = await response.json();
  try {
    return {
      sha: String(file.sha),
      config: JSON.parse(Buffer.from(String(file.content ?? ""), "base64").toString("utf8")) as TenantConfigDraft,
    };
  } catch {
    return Response.json({ error: "La configuración del tenant no es JSON válido." }, { status: 502 });
  }
}

async function updateAutomaticSending(bot: BotRow, active: boolean) {
  const base = String(bot.bot_status_url ?? "").replace(/\/$/, "");
  const secret = process.env.STAGE_PLATFORM_ADMIN_SECRET?.trim() || bot.bot_secret || "";
  if (!base || !secret) throw new Error("Falta el endpoint o secreto para actualizar el envío automático.");
  const endpoint = base.endsWith("/bot-activo")
    ? base.replace(/\/bot-activo$/, "/envio-automatico")
    : `${base}/api/${bot.slug}/config/envio-automatico`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-platform-secret": secret },
    body: JSON.stringify({ activo: active }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `El bot rechazó el modo de envío (${response.status}).`);
  }
}

function appNameFromStatusUrl(value: string | null | undefined) {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    if (!host.endsWith(".fly.dev")) return null;
    const appName = host.slice(0, -".fly.dev".length);
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(appName) ? appName : null;
  } catch {
    return null;
  }
}

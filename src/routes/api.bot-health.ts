import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-only: el navegador nunca habla con los backends de los bots (ni con
// el secreto de plataforma). Llama a esta ruta con el token del owner; aquí se
// verifica owner, se leen los bots (service role), y se consulta el /health y
// el estado de WhatsApp de cada uno con el secreto de plataforma — que jamás
// llega al bundle del navegador. Ademas registra/resuelve alertas en
// owner_alerts para no perder el historial ni spamear.

interface BotRow {
  id: string;
  name: string | null;
  slug: string | null;
  kind: string | null;
  status: string | null;
  bot_status_url: string | null;
  client_id: string | null;
}

interface BotHealth {
  botId: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  clientName: string;
  host: string | null;
  reachable: boolean;
  tenants: number | null;
  whatsapp: "connected" | "disconnected" | "unknown";
  numero: string | null;
  severity: "ok" | "warn" | "down" | "unknown";
  statusLabel: string;
  checkedAt: string;
}

const FETCH_TIMEOUT_MS = 6000;

export const Route = createFileRoute("/api/bot-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user)
          return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: isOwner } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "owner",
        });
        if (!isOwner) return Response.json({ error: "No autorizado." }, { status: 401 });

        if (!process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY) {
          return Response.json(
            { error: "Falta STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local (.env.local)." },
            { status: 500 },
          );
        }
        const secret = process.env.STAGE_PLATFORM_ADMIN_SECRET?.trim() ?? "";

        const { data: botsData, error: botsError } = await supabaseAdmin
          .from("client_bots")
          .select("id,name,slug,kind,status,bot_status_url,client_id");
        if (botsError) return Response.json({ error: botsError.message }, { status: 500 });
        const bots = (botsData ?? []) as BotRow[];

        const clientIds = [...new Set(bots.map((b) => b.client_id).filter(Boolean) as string[])];
        const nameById = new Map<string, string>();
        if (clientIds.length) {
          const { data: clients } = await supabaseAdmin
            .from("clients")
            .select("id,company_name")
            .in("id", clientIds);
          for (const c of clients ?? []) nameById.set(c.id, c.company_name ?? "Cliente");
        }

        const results = await Promise.all(bots.map((bot) => checkBot(bot, secret, nameById)));

        // Registrar / resolver alertas por transición (sin spamear).
        await Promise.all(results.map((r) => reconcileAlert(r)));

        const { data: alerts } = await supabaseAdmin
          .from("owner_alerts")
          .select("id,bot_slug,bot_name,client_name,type,severity,message,created_at,resolved_at")
          .order("created_at", { ascending: false })
          .limit(40);

        const summary = {
          total: results.length,
          up: results.filter((r) => r.reachable).length,
          down: results.filter((r) => r.severity === "down").length,
          waConnected: results.filter((r) => r.whatsapp === "connected").length,
          waDisconnected: results.filter((r) => r.whatsapp === "disconnected").length,
          activeAlerts: (alerts ?? []).filter((a) => !a.resolved_at).length,
        };

        return Response.json({
          bots: results,
          alerts: alerts ?? [],
          summary,
          checkedAt: new Date().toISOString(),
        });
      },
    },
  },
});

function deriveHost(botStatusUrl: string | null): string | null {
  if (!botStatusUrl) return null;
  const clean = botStatusUrl.trim();
  const idx = clean.indexOf("/api/");
  const base = idx >= 0 ? clean.slice(0, idx) : clean.replace(/\/$/, "");
  return /^https?:\/\//.test(base) ? base : null;
}

async function checkBot(
  bot: BotRow,
  secret: string,
  nameById: Map<string, string>,
): Promise<BotHealth> {
  const slug = bot.slug ?? "";
  const clientName = (bot.client_id && nameById.get(bot.client_id)) || bot.name || "Cliente";
  const host = deriveHost(bot.bot_status_url);
  const status = bot.status ?? "draft";

  const base: BotHealth = {
    botId: bot.id,
    name: bot.name ?? slug ?? "Bot",
    slug,
    kind: bot.kind ?? "messaging",
    status,
    clientName,
    host,
    reachable: false,
    tenants: null,
    whatsapp: "unknown",
    numero: null,
    severity: "unknown",
    statusLabel: "Sin desplegar",
    checkedAt: new Date().toISOString(),
  };

  if (!host) return base;

  try {
    const r = await fetch(`${host}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (r.ok) {
      const d = await r.json().catch(() => null);
      base.reachable = Boolean(d?.ok);
      base.tenants = typeof d?.tenants === "number" ? d.tenants : null;
    }
  } catch {
    /* no alcanzable */
  }

  if (base.reachable && secret && slug) {
    try {
      const r = await fetch(`${host}/api/${encodeURIComponent(slug)}/whatsapp/status`, {
        headers: { "x-platform-secret": secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.ok) {
        const d = await r.json().catch(() => null);
        base.whatsapp = d?.conectado ? "connected" : "disconnected";
        base.numero = d?.numero ?? null;
      }
    } catch {
      /* status no disponible */
    }
  }

  // Severidad. Un bot en borrador/pausado no genera "caído".
  if (status === "draft") {
    base.severity = "unknown";
    base.statusLabel = "Sin desplegar";
  } else if (!base.reachable) {
    base.severity = "down";
    base.statusLabel = "Caído";
  } else if (status === "active" && base.whatsapp === "disconnected") {
    base.severity = "warn";
    base.statusLabel = "WhatsApp desconectado";
  } else if (status === "paused") {
    base.severity = "unknown";
    base.statusLabel = "Pausado";
  } else {
    base.severity = "ok";
    base.statusLabel = "Operativo";
  }

  return base;
}

/** Abre una alerta cuando aparece un problema nuevo y la cierra al recuperarse. */
async function reconcileAlert(r: BotHealth) {
  // Solo alertamos de bots activos: un borrador o pausado no es una falla.
  const problem: "down" | "wa_disconnected" | null =
    r.status !== "active"
      ? null
      : !r.reachable
        ? "down"
        : r.whatsapp === "disconnected"
          ? "wa_disconnected"
          : null;

  const { data: open } = await supabaseAdmin
    .from("owner_alerts")
    .select("id,type")
    .eq("bot_id", r.botId)
    .is("resolved_at", null);
  const openTypes = new Set((open ?? []).map((a) => a.type as string));

  if (problem) {
    if (openTypes.has(problem)) return; // ya avisado, no repetir
    // El problema cambió de tipo: cierra los anteriores antes de abrir el nuevo.
    if (openTypes.size) {
      await supabaseAdmin
        .from("owner_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("bot_id", r.botId)
        .is("resolved_at", null);
    }
    const message =
      problem === "down"
        ? `El bot de ${r.clientName} (${r.slug}) está CAÍDO — no responde.`
        : `El WhatsApp del bot de ${r.clientName} (${r.slug}) se DESCONECTÓ.`;
    await supabaseAdmin.from("owner_alerts").insert({
      bot_id: r.botId,
      bot_slug: r.slug,
      bot_name: r.name,
      client_name: r.clientName,
      type: problem,
      severity: problem === "down" ? "down" : "warn",
      message,
    });
  } else if (openTypes.size) {
    // Se recuperó: cierra cualquier alerta abierta.
    await supabaseAdmin
      .from("owner_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .eq("bot_id", r.botId)
      .is("resolved_at", null);
  }
}

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
  email: "connected" | "disconnected" | "not_applicable" | "unknown";
  pendingFailures: number;
  averageLatencyMs: number;
  slowResponses: number;
  tokens24h: number;
  abnormalCost: boolean;
  failures: Array<{ id: string; source: string; operation: string; message: string; status: string; attempts: number; maxAttempts: number; updatedAt: string }>;
  runtime: { mode: "shadow" | "limited" | "live" | "paused"; autoSendPercentage: number; monthlyMessages: number; monthlyEmails: number; monthlyTokens: number; monthlyCostUsd: number } | null;
  usage: Array<{ channel: string; messages: number; emails: number; input_tokens: number; output_tokens: number; estimated_cost_usd: number }>;
  handoffs: Array<{ channel: string; conversation_id: string; taken_by: string; reason: string; taken_at: string }>;
  shadows: Array<{ id: string; channel: string; conversation_id: string; proposed_response: string; decision: string; reviewed: boolean; correct_response: string | null; created_at: string }>;
  channelTests: Array<{ id: string; channel: string; status: string; challenge: string; destination: string; results: Record<string, boolean>; error: string | null; started_at: string }>;
  conversations: Array<{ channel: "whatsapp" | "email"; id: string; contact: string; subject: string | null; updatedAt: string }>;
  emailFollowups: Array<{ id: string; thread_id: string; recipient: string; subject: string; task_type: string; title: string; notes: string | null; status: string; draft_reply: string | null; owner_note: string | null; created_at: string; updated_at: string }>;
  severity: "ok" | "warn" | "down" | "unknown";
  statusLabel: string;
  checkedAt: string;
}

const FETCH_TIMEOUT_MS = 15_000;

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
        const command = await request.json().catch(() => null) as any;
        if (command?.action && command?.slug) {
          const bot = bots.find((item) => item.slug === command.slug);
          const host = deriveHost(bot?.bot_status_url ?? null);
          if (!bot || !host || !secret) return Response.json({ error: "No se puede contactar ese bot." }, { status: 400 });
          const slug = encodeURIComponent(command.slug);
          let path = "";
          let method = "POST";
          if (command.action === "runtime") path = `/api/${slug}/operations/runtime`;
          else if (command.action === "channelTest") path = `/api/${slug}/operations/channel-tests/${command.channel === "email" ? "email" : "whatsapp"}`;
          else if (command.action === "take" || command.action === "return") path = `/api/${slug}/operations/conversations/${command.channel === "email" ? "email" : "whatsapp"}/${encodeURIComponent(command.conversationId)}/${command.action}`;
          else if (command.action === "reviewShadow") path = `/api/${slug}/operations/shadows/${encodeURIComponent(command.id)}/review`;
          else if (command.action === "replyFollowup") path = `/api/${slug}/operations/email-followups/${encodeURIComponent(command.id)}/reply`;
          else if (command.action === "resolveFollowup") path = `/api/${slug}/operations/email-followups/${encodeURIComponent(command.id)}/resolve`;
          else if (command.action === "recoveryDrill") path = `/api/${slug}/operations/recovery-drill`;
          else if (command.action === "export") { path = `/api/${slug}/operations/export`; method = "GET"; }
          else return Response.json({ error: "Acción desconocida." }, { status: 400 });
          const upstream = await fetch(`${host}${path}`, {
            method,
            headers: { "x-platform-secret": secret, "content-type": "application/json" },
            ...(method === "GET" ? {} : { body: JSON.stringify(command.payload ?? {}) }),
            signal: AbortSignal.timeout(90_000),
          });
          const payload = await upstream.json().catch(() => null);
          return Response.json(payload ?? { ok: upstream.ok }, { status: upstream.status });
        }

        const url = new URL(request.url);
        const retrySlug = url.searchParams.get("retrySlug")?.trim();
        const failureId = url.searchParams.get("failureId")?.trim();
        const failureAction = url.searchParams.get("failureAction") === "resolve" ? "resolve" : "retry";
        if (retrySlug && failureId) {
          const bot = bots.find((item) => item.slug === retrySlug);
          const host = deriveHost(bot?.bot_status_url ?? null);
          if (!bot || !host || !secret) return Response.json({ error: "No se puede contactar ese bot." }, { status: 400 });
          const retry = await fetch(`${host}/api/${encodeURIComponent(retrySlug)}/operations/failures/${encodeURIComponent(failureId)}/${failureAction}`, {
            method: "POST",
            headers: { "x-platform-secret": secret },
            signal: AbortSignal.timeout(45_000),
          });
          const payload = await retry.json().catch(() => null);
          if (!retry.ok) return Response.json({ error: payload?.error || `La operación respondió ${retry.status}.` }, { status: retry.status });
          return Response.json({ ok: true });
        }

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
    email: bot.kind === "assistant" ? "unknown" : "not_applicable",
    pendingFailures: 0,
    averageLatencyMs: 0,
    slowResponses: 0,
    tokens24h: 0,
    abnormalCost: false,
    failures: [],
    runtime: null,
    usage: [],
    handoffs: [],
    shadows: [],
    channelTests: [],
    conversations: [],
    emailFollowups: [],
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
    try {
      const r = await fetch(`${host}/api/${encodeURIComponent(slug)}/operations/status`, {
        headers: { "x-platform-secret": secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (r.ok) {
        const d = await r.json().catch(() => null);
        base.email = bot.kind === "assistant" ? (d?.email?.connected ? "connected" : "disconnected") : "not_applicable";
        base.pendingFailures = Number(d?.pendingFailures ?? 0);
        base.averageLatencyMs = Number(d?.averageLatencyMs ?? 0);
        base.slowResponses = Number(d?.slowResponses ?? 0);
        base.tokens24h = Number(d?.tokens24h ?? 0);
        base.abnormalCost = Boolean(d?.abnormalCost);
        base.failures = Array.isArray(d?.failures) ? d.failures : [];
        base.runtime = d?.runtime ?? null;
        base.usage = Array.isArray(d?.usage) ? d.usage : [];
        base.handoffs = Array.isArray(d?.handoffs) ? d.handoffs : [];
        base.shadows = Array.isArray(d?.shadows) ? d.shadows : [];
        base.channelTests = Array.isArray(d?.channelTests) ? d.channelTests : [];
        base.conversations = Array.isArray(d?.conversations) ? d.conversations : [];
        base.emailFollowups = Array.isArray(d?.emailFollowups) ? d.emailFollowups : [];
      }
    } catch {
      /* telemetría no disponible en versiones antiguas */
    }
  }

  // Severidad. Un bot en borrador/pausado no genera "caído".
  if (status === "draft") {
    base.severity = "unknown";
    base.statusLabel = "Sin desplegar";
  } else if (!base.reachable) {
    base.severity = "down";
    base.statusLabel = "Caído";
  } else if (status === "active" && (base.whatsapp === "disconnected" || base.email === "disconnected" || base.pendingFailures > 0 || base.abnormalCost)) {
    base.severity = "warn";
    base.statusLabel = base.whatsapp === "disconnected" ? "WhatsApp desconectado" : base.email === "disconnected" ? "Correo/OAuth desconectado" : base.abnormalCost ? "Costo anormal" : "Operaciones pendientes";
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
  const problem: "down" | "wa_disconnected" | "email_disconnected" | "operation_failures" | "slow_responses" | "abnormal_cost" | null =
    r.status !== "active"
      ? null
      : !r.reachable
        ? "down"
        : r.whatsapp === "disconnected"
          ? "wa_disconnected"
          : r.email === "disconnected"
            ? "email_disconnected"
            : r.pendingFailures > 0
              ? "operation_failures"
              : r.abnormalCost
                ? "abnormal_cost"
                : r.slowResponses > 0
                  ? "slow_responses"
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
    const correctedMessage = operationalAlertMessage(problem, r, message);
    await supabaseAdmin.from("owner_alerts").insert({
      bot_id: r.botId,
      bot_slug: r.slug,
      bot_name: r.name,
      client_name: r.clientName,
      type: problem,
      severity: problem === "down" ? "down" : "warn",
      message: correctedMessage,
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

function operationalAlertMessage(problem: string, r: BotHealth, fallback: string) {
  if (problem === "email_disconnected") return `El OAuth o correo de ${r.clientName} (${r.slug}) necesita reconexión.`;
  if (problem === "operation_failures") return `${r.pendingFailures} operación(es) de ${r.clientName} requieren reintento o intervención.`;
  if (problem === "slow_responses") return `${r.slowResponses} respuesta(s) lenta(s) detectadas para ${r.clientName}.`;
  if (problem === "abnormal_cost") return `Consumo anormal detectado para ${r.clientName}: ${r.tokens24h.toLocaleString()} tokens en 24 h.`;
  return fallback;
}

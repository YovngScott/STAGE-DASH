import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Interruptor del envío automático de un bot asistente, desde Client Manager.
 *
 * Mismo puente que api.bot-toggle: el navegador nunca ve el secreto del bot.
 * Se verifica el token del owner contra el Supabase de Stage AI Labs, se lee
 * la URL/secret del bot con la service role, y solo entonces se reenvía la
 * orden al backend de ESE cliente.
 *
 * GET  → estado actual (para pintar el botón sin adivinar)
 * POST → { activo: boolean }
 *
 * El backend guarda el valor en su propia base y el triaje lo lee en cada
 * corrida, así que el cambio surte efecto sin redesplegar nada.
 */
export const Route = createFileRoute("/api/bot-envio-automatico")({
  server: {
    handlers: {
      GET: async ({ request }) => manejar(request, "GET"),
      POST: async ({ request }) => manejar(request, "POST"),
    },
  },
});

async function manejar(request: Request, metodo: "GET" | "POST") {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "No autorizado." }, { status: 401 });

  const { data: isOwner } = await supabase.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "owner",
  });
  if (!isOwner) return Response.json({ error: "No autorizado." }, { status: 401 });

  // En GET los parámetros vienen por la URL; en POST, en el cuerpo.
  const url = new URL(request.url);
  let botId = url.searchParams.get("botId") ?? "";
  let botSlug = url.searchParams.get("botSlug") ?? "";
  let activo = false;

  if (metodo === "POST") {
    try {
      const body = (await request.json()) as { botId?: string; botSlug?: string; activo?: boolean };
      botId = String(body.botId ?? "");
      botSlug = String(body.botSlug ?? "");
      activo = Boolean(body.activo);
    } catch {
      return Response.json({ error: "Body inválido." }, { status: 400 });
    }
  }

  const slug = sanitizeSlug(botSlug);
  if (!botId || !slug) return Response.json({ error: "Falta botId o botSlug." }, { status: 400 });

  const { data: bot, error: botError } = await supabaseAdmin
    .from("client_bots")
    .select("bot_status_url,bot_secret,kind")
    .eq("id", botId)
    .maybeSingle();
  if (botError) {
    return Response.json({ error: `No se pudo leer el bot: ${botError.message}` }, { status: 500 });
  }
  if (bot?.kind !== "assistant") {
    return Response.json({ error: "El envío automático solo aplica a bots asistente." }, { status: 400 });
  }

  const base = (bot?.bot_status_url ?? "").trim().replace(/\/$/, "");
  // Se prefiere el secreto global vigente: el guardado en la fila puede haber
  // quedado obsoleto tras una rotación.
  const secreto = process.env.STAGE_PLATFORM_ADMIN_SECRET?.trim() || bot?.bot_secret || "";
  if (!base || !secreto) {
    return Response.json({ error: "Este bot no tiene endpoint o secreto configurado." }, { status: 400 });
  }

  // bot_status_url apunta a .../config/bot-activo; el interruptor del envío
  // vive junto a él, así que se reemplaza el último segmento.
  const endpoint = base.endsWith("/bot-activo")
    ? base.replace(/\/bot-activo$/, "/envio-automatico")
    : `${base}/api/${slug}/config/envio-automatico`;

  try {
    const res = await fetch(endpoint, {
      method: metodo,
      headers: { "content-type": "application/json", "x-platform-secret": secreto },
      ...(metodo === "POST" ? { body: JSON.stringify({ activo }) } : {}),
    });
    const cuerpo = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json(
        { error: cuerpo?.error ?? `El bot respondió con error (${res.status}).` },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, activo: Boolean(cuerpo?.activo) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "No se pudo contactar el bot." },
      { status: 502 },
    );
  }
}

function sanitizeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

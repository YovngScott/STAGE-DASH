import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-only bridge: the browser never talks to a client's separate bot
// backend (and its shared secret) directly. It calls this route with the
// signed-in owner's Supabase access token; this handler verifies that
// token + the "owner" role against Stage AI Labs' own Supabase project,
// looks up the client's bot_status_url/bot_secret (service role, bypasses
// RLS), and only then forwards the toggle to that client's bot backend
// with its secret — which never reaches the browser bundle.

export const Route = createFileRoute("/api/bot-toggle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }

        let body: {
          clientId?: string;
          botId?: string;
          botSlug?: string;
          activo?: boolean;
          botStatusUrl?: string;
          botSecret?: string;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body inválido." }, { status: 400 });
        }
        const clientId = String(body.clientId ?? "");
        const botId = String(body.botId ?? "");
        const botSlug = sanitizeSlug(String(body.botSlug ?? ""));
        const activo = Boolean(body.activo);
        if (!clientId && !botId && (!body.botStatusUrl || !body.botSecret)) {
          return Response.json({ error: "Falta clientId, botId o credenciales locales del bot." }, { status: 400 });
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

        let botStatusUrl = body.botStatusUrl?.trim() || "";
        let botSecret = body.botSecret?.trim() || "";

        if (!botStatusUrl || !botSecret) {
          if (botId) {
            const { data: bot, error: botError } = await supabaseAdmin
              .from("client_bots")
              .select("bot_status_url,bot_secret")
              .eq("id", botId)
              .maybeSingle();
            if (botError) {
              return Response.json(
                { error: `No se pudo leer el bot (revisa STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local): ${botError.message}` },
                { status: 500 },
              );
            }
            botStatusUrl = bot?.bot_status_url ?? "";
            botSecret = bot?.bot_secret ?? "";
          } else {
            const { data: client, error: clientError } = await supabaseAdmin
              .from("clients")
              .select("bot_status_url,bot_secret")
              .eq("id", clientId)
              .maybeSingle();
            if (clientError) {
              console.error("[bot-toggle] Error reading client row:", clientError);
              return Response.json(
                { error: `No se pudo leer el cliente (revisa STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local): ${clientError.message}` },
                { status: 500 },
              );
            }
            botStatusUrl = client?.bot_status_url ?? "";
            botSecret = client?.bot_secret ?? "";
          }
        }
        if (!botStatusUrl || !botSecret) {
          return Response.json(
            { error: "Este cliente no tiene un bot configurado (bot_status_url / bot_secret)." },
            { status: 400 },
          );
        }

        // Un bot single-tenant expone la ruta fija /api/config/bot-activo, así
        // que basta guardar su host. Uno multi-cliente la expone bajo el slug
        // (/api/<slug>/config/bot-activo) y no hay forma de derivar esa ruta
        // desde el host: para esos se guarda la URL completa del endpoint.
        const url = buildBotStatusUrl(botStatusUrl, botSlug);

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-platform-secret": botSecret,
            },
            body: JSON.stringify({ activo }),
          });
          if (!res.ok) {
            const text = await res.text();
            return Response.json(
              { error: `El bot respondió con error (${res.status}): ${text.slice(0, 200)}` },
              { status: 502 },
            );
          }
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "No se pudo contactar el bot." },
            { status: 502 },
          );
        }

        if (botId) {
          await supabaseAdmin
            .from("client_bots")
            .update({ status: activo ? "active" : "paused" })
            .eq("id", botId);
        }
        if (clientId) {
          await supabaseAdmin.from("clients").update({ bot_activo: activo }).eq("id", clientId);
        }

        return Response.json({ ok: true, activo });
      },
    },
  },
});

function buildBotStatusUrl(rawUrl: string, slug: string) {
  const base = rawUrl.trim().replace(/\/$/, "");
  if (base.endsWith("/bot-activo")) return base;
  if (slug) return `${base}/api/${slug}/config/bot-activo`;
  return `${base}/api/config/bot-activo`;
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

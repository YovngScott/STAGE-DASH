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

        let body: { clientId?: string; activo?: boolean };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body inválido." }, { status: 400 });
        }
        const clientId = String(body.clientId ?? "");
        const activo = Boolean(body.activo);
        if (!clientId) {
          return Response.json({ error: "Falta clientId." }, { status: 400 });
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

        const { data: client, error: clientError } = await supabaseAdmin
          .from("clients")
          .select("bot_status_url,bot_secret")
          .eq("id", clientId)
          .maybeSingle();
        if (clientError || !client?.bot_status_url || !client?.bot_secret) {
          return Response.json(
            { error: "Este cliente no tiene un bot configurado (bot_status_url / bot_secret)." },
            { status: 400 },
          );
        }

        try {
          const res = await fetch(`${client.bot_status_url.replace(/\/$/, "")}/api/config/bot-activo`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-platform-secret": client.bot_secret,
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

        await supabaseAdmin.from("clients").update({ bot_activo: activo }).eq("id", clientId);

        return Response.json({ ok: true, activo });
      },
    },
  },
});

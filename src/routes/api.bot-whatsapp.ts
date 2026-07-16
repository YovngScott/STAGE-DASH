import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/bot-whatsapp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "owner" });
        if (!isOwner) return Response.json({ error: "No autorizado." }, { status: 401 });

        const body = await request.json().catch(() => null) as { clientId?: string; botId?: string } | null;
        if (!body?.clientId) return Response.json({ error: "Falta clientId." }, { status: 400 });

        let statusUrl: string | null = null;
        let storedSecret: string | null = null;
        if (body.botId) {
          const { data: bot, error } = await supabaseAdmin
            .from("client_bots")
            .select("bot_status_url,bot_secret")
            .eq("id", body.botId)
            .eq("client_id", body.clientId)
            .maybeSingle();
          if (error) return Response.json({ error: error.message }, { status: 500 });
          statusUrl = bot?.bot_status_url ?? null;
          storedSecret = bot?.bot_secret ?? null;
        }

        if (!statusUrl) {
          const { data: client, error } = await supabaseAdmin
            .from("clients")
            .select("bot_status_url,bot_secret")
            .eq("id", body.clientId)
            .maybeSingle();
          if (error) return Response.json({ error: error.message }, { status: 500 });
          statusUrl = client?.bot_status_url ?? null;
          storedSecret = client?.bot_secret ?? null;
        }
        if (!statusUrl) return Response.json({ error: "Este bot no tiene una URL de estado configurada." }, { status: 400 });

        const secret = process.env.STAGE_PLATFORM_ADMIN_SECRET || storedSecret;
        if (!secret) return Response.json({ error: "Falta el secreto de plataforma local." }, { status: 500 });

        const whatsappUrl = statusUrl.replace(/\/config\/bot-activo\/?(?:\?.*)?$/, "/whatsapp/status");
        const response = await fetch(whatsappUrl, { headers: { "x-platform-secret": secret } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          return Response.json(
            { error: payload?.error ?? `El bot respondió ${response.status}.`, status: response.status },
            { status: response.status >= 400 && response.status < 500 ? 502 : 503 },
          );
        }
        return Response.json({ status: payload, endpoint: whatsappUrl });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvisionJob } from "@/lib/provisioning";

export const Route = createFileRoute("/api/provision-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "owner" });
        if (!isOwner) return Response.json({ error: "No autorizado." }, { status: 401 });

        const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
        if (!jobId) return Response.json({ error: "Falta jobId." }, { status: 400 });
        const job = getProvisionJob(jobId);
        if (!job) {
          const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
          if (slug) {
            const { data: bot, error: botError } = await supabaseAdmin
              .from("client_bots")
              .select("status,fly_app_name,fly_app_url,dashboard_url,last_error")
              .eq("slug", slug)
              .maybeSingle();
            if (botError) return Response.json({ error: botError.message }, { status: 500 });
            if (bot?.status === "active") {
              return Response.json({ job: {
                id: jobId, slug, state: "complete", progress: 100,
                message: "Bot publicado correctamente.", appName: bot.fly_app_name,
                botStatusUrl: bot.fly_app_url, dashboardUrl: bot.dashboard_url,
              } });
            }
            if (bot) {
              return Response.json({ job: {
                id: jobId, slug, state: "failed", progress: 100,
                message: "La creación se interrumpió antes de terminar.",
                error: bot.last_error || "Owner Console se reinició. Puedes pulsar Crear nuevamente: el proceso reutiliza de forma segura lo que ya exista.",
                appName: bot.fly_app_name, botStatusUrl: bot.fly_app_url,
                dashboardUrl: bot.dashboard_url,
              } });
            }
          }
          return Response.json({ error: "No se encontró el trabajo de creación." }, { status: 404 });
        }
        return Response.json({ job });
      },
    },
  },
});

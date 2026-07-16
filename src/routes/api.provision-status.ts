import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
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
          return Response.json(
            { error: "No se encontró el trabajo. Si el Owner Console se reinició, revisa Fly.io y GitHub antes de intentar de nuevo." },
            { status: 404 },
          );
        }
        return Response.json({ job });
      },
    },
  },
});

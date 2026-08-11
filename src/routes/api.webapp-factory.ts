import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listWebAppDeployments,
  listWebAppTemplates,
  rollbackWebAppDeployment,
  startWebAppProvision,
  type WebAppFactoryInput,
} from "@/lib/webapp-factory.server";

async function owner(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return false;
  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: data.user.id, _role: "owner" });
  return Boolean(isOwner);
}

export const Route = createFileRoute("/api/webapp-factory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await owner(request))) return Response.json({ error: "No autorizado." }, { status: 401 });
        try {
          const [templates, deployments] = await Promise.all([listWebAppTemplates(), listWebAppDeployments()]);
          return Response.json({ templates, deployments });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        if (!(await owner(request))) return Response.json({ error: "No autorizado." }, { status: 401 });
        try {
          const body = await request.json();
          if (body.action === "rollback") {
            await rollbackWebAppDeployment(String(body.id || ""));
            return Response.json({ ok: true });
          }
          if (body.action !== "replicate") return Response.json({ error: "Acción inválida." }, { status: 400 });
          const deployment = await startWebAppProvision(body.input as WebAppFactoryInput);
          return Response.json({ ok: true, deployment }, { status: 202 });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
        }
      },
    },
  },
});

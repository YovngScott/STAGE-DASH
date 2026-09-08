import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { authorizeOwner } from "@/lib/auth-owner.server";
import {
  listWebAppDeployments,
  listWebAppTemplates,
  getWebAppFactoryStatus,
  rollbackWebAppDeployment,
  startWebAppProvision,
  type WebAppFactoryInput,
} from "@/lib/webapp-factory.server";

export const Route = createFileRoute("/api/webapp-factory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
        try {
          const [templates, deployments, platform] = await Promise.all([listWebAppTemplates(), listWebAppDeployments(), getWebAppFactoryStatus()]);
          return Response.json({ templates, deployments, platform });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const denied = await authorizeOwner(request);
        if (denied) return denied;
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

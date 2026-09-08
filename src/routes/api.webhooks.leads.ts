import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_ORIGINS = [
  "https://stage-labs.ai.studio",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowOrigin =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".trycloudflare.com")
      ? origin
      : "https://stage-labs.ai.studio";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

export const Route = createFileRoute("/api/webhooks/leads")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request),
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = getCorsHeaders(request);

        let body: {
          name?: string;
          email?: string;
          company?: string;
          service?: string;
          services?: string[] | string;
          interest?: string | string[];
          message?: string;
          phone?: string;
        };

        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: "Payload JSON inválido o malformado." },
            { status: 400, headers: corsHeaders },
          );
        }

        const name = String(body.name ?? "").trim();
        const email = String(body.email ?? "").trim();
        const company = String(body.company ?? "").trim() || null;
        const message = String(body.message ?? "").trim() || null;

        if (!name || !email) {
          return Response.json(
            { error: "Los campos 'name' y 'email' son obligatorios." },
            { status: 400, headers: corsHeaders },
          );
        }

        let servicesList: string[] = [];
        if (Array.isArray(body.services)) {
          servicesList = body.services.map(String);
        } else if (Array.isArray(body.interest)) {
          servicesList = body.interest.map(String);
        } else if (typeof body.services === "string" && body.services.trim()) {
          servicesList = body.services.split(",").map((s) => s.trim());
        } else if (typeof body.service === "string" && body.service.trim()) {
          servicesList = body.service.split(",").map((s) => s.trim());
        } else if (typeof body.interest === "string" && body.interest.trim()) {
          servicesList = body.interest.split(",").map((s) => s.trim());
        }

        const leadRecord = {
          name,
          email,
          company,
          services: servicesList.length > 0 ? servicesList : null,
          message,
          status: "new",
        };

        let { data, error } = await supabaseAdmin
          .from("leads")
          .insert(leadRecord)
          .select()
          .single();

        if (error?.code === "42703" || error?.code === "PGRST204") {
          const legacyRecord = {
            name,
            email,
            company,
            service: servicesList.join(", ") || null,
            message,
            status: "new",
          };

          const retryResult = await supabaseAdmin
            .from("leads")
            .insert(legacyRecord)
            .select()
            .single();

          data = retryResult.data;
          error = retryResult.error;
        }

        if (error) {
          console.error("[Leads Webhook] Error al insertar en Supabase:", error);
          return Response.json(
            {
              error: "Error interno al registrar el lead en la base de datos.",
              details: error.message,
            },
            { status: 500, headers: corsHeaders },
          );
        }

        return Response.json(
          {
            success: true,
            message: "Lead registrado exitosamente.",
            lead: data,
          },
          {
            status: 201,
            headers: corsHeaders,
          },
        );
      },
    },
  },
});

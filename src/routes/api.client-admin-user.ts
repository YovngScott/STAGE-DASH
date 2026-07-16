import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MESSAGING_SUPABASE_URL =
  process.env.STAGE_MESSAGING_SUPABASE_URL || "https://vulyyztktylldfnuvzbn.supabase.co";

interface CreateAdminUserBody {
  clientId?: string;
  tenantSlug?: string;
  email?: string;
  password?: string;
  displayName?: string;
}

export const Route = createFileRoute("/api/client-admin-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });

        let body: CreateAdminUserBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body invalido." }, { status: 400 });
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }
        const { data: isOwner } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "owner",
        });
        if (!isOwner) return Response.json({ error: "No autorizado." }, { status: 401 });

        const clientId = String(body.clientId ?? "");
        const tenantSlug = String(body.tenantSlug ?? "").trim();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "").trim();
        if (!clientId || !tenantSlug || !email || password.length < 8) {
          return Response.json(
            { error: "Faltan clientId, tenantSlug, email o password de al menos 8 caracteres." },
            { status: 400 },
          );
        }

        const messagingServiceRole = process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY;
        if (!messagingServiceRole) {
          return Response.json(
            { error: "Falta STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY para crear usuarios en la Supabase de bots." },
            { status: 500 },
          );
        }

        const messagingAdmin = createClient(MESSAGING_SUPABASE_URL, messagingServiceRole, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: authData, error: authError } = await messagingAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: body.displayName ?? "" },
        });
        if (authError && !authError.message.toLowerCase().includes("already")) {
          return Response.json({ error: authError.message }, { status: 502 });
        }

        const userId = authData.user?.id;
        if (userId) {
          const { error: adminError } = await messagingAdmin.from("tenant_admins").insert({
            user_id: userId,
            tenant_id: await resolveTenantId(messagingAdmin, tenantSlug),
          });
          if (adminError && !adminError.message.toLowerCase().includes("duplicate")) {
            return Response.json({ error: adminError.message }, { status: 502 });
          }
        }

        await supabaseAdmin.from("client_email_accounts").upsert(
          {
            client_id: clientId,
            email,
            display_name: body.displayName?.trim() || null,
            provider: "supabase-auth",
            status: "active",
            auth_user_id: userId ?? null,
          },
          { onConflict: "email" },
        );

        return Response.json({ ok: true, email, userId });
      },
    },
  },
});

async function resolveTenantId(
  messagingAdmin: ReturnType<typeof createClient>,
  tenantSlug: string,
) {
  const { data, error } = await messagingAdmin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.id) throw new Error(`No existe el tenant ${tenantSlug}.`);
  return data.id as string;
}

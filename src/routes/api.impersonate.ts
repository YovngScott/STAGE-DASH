import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MESSAGING_SUPABASE_URL =
  process.env.STAGE_MESSAGING_SUPABASE_URL || "https://vulyyztktylldfnuvzbn.supabase.co";

type MessagingAdmin = any;

export const Route = createFileRoute("/api/impersonate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;

        let body: { clientId?: string; tenantSlug?: string; redirectTo?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body inválido." }, { status: 400 });
        }

        const clientId = String(body.clientId ?? "").trim();
        const tenantSlug = String(body.tenantSlug ?? "").trim().toLowerCase();
        const redirectTo = String(body.redirectTo ?? "").trim();

        if (!clientId || !tenantSlug) {
          return Response.json({ error: "Faltan clientId o tenantSlug." }, { status: 400 });
        }

        try {
          // 1. Validar que el cliente sea dueño de este tenant
          await assertClientOwnsTenant(clientId, tenantSlug);

          // 2. Conectar a la base de mensajería
          const messagingAdmin = getMessagingAdmin();
          const tenantId = await resolveTenantId(messagingAdmin, tenantSlug);

          // 3. Buscar usuarios asociados al tenant
          const { data: memberships, error: membershipsError } = await messagingAdmin
            .from("tenant_admins")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .limit(1);

          if (membershipsError) throw new Error(membershipsError.message);
          
          const firstMembership = memberships?.[0];
          if (!firstMembership) {
            return Response.json(
              { error: "Este cliente no tiene ningún usuario de dashboard configurado. Crea uno en la ficha de clientes primero." },
              { status: 400 }
            );
          }

          // 4. Obtener el email del usuario de auth de Supabase
          const { data: userData, error: userError } = await messagingAdmin.auth.admin.getUserById(
            firstMembership.user_id
          );
          if (userError || !userData?.user?.email) {
            throw new Error(userError?.message || "No se pudo recuperar el correo del usuario.");
          }

          const email = userData.user.email;

          // 5. Generar enlace de ingreso de un solo uso (magiclink)
          const { data: linkData, error: linkError } = await messagingAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: {
              redirectTo: redirectTo || undefined,
            },
          });

          if (linkError || !linkData?.properties?.action_link) {
            throw new Error(linkError?.message || "No se pudo generar el enlace de impersonación.");
          }

          return Response.json({ ok: true, url: linkData.properties.action_link });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Error durante la impersonación." },
            { status: 502 }
          );
        }
      },
    },
  },
});

async function requireOwner(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "owner" });
  return isOwner ? null : Response.json({ error: "No autorizado." }, { status: 401 });
}

function getMessagingAdmin(): MessagingAdmin {
  const key = process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY para generar el enlace.");
  return createClient(MESSAGING_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveTenantId(messagingAdmin: MessagingAdmin, tenantSlug: string) {
  const { data, error } = await messagingAdmin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
  if (error || !data?.id) throw new Error(`No existe el tenant ${tenantSlug}.`);
  return data.id as string;
}

async function assertClientOwnsTenant(clientId: string, tenantSlug: string) {
  const [{ data: bot, error: botError }, { data: dashboard, error: dashboardError }] = await Promise.all([
    supabaseAdmin
      .from("client_bots")
      .select("id")
      .eq("client_id", clientId)
      .eq("slug", tenantSlug)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("client_dashboards")
      .select("id")
      .eq("client_id", clientId)
      .eq("slug", tenantSlug)
      .limit(1)
      .maybeSingle(),
  ]);
  if (botError) throw new Error(`No se pudo validar el bot del cliente: ${botError.message}`);
  if (dashboardError) throw new Error(`No se pudo validar el dashboard del cliente: ${dashboardError.message}`);
  if (!bot && !dashboard) {
    throw new Error("El tenant seleccionado no pertenece a este cliente.");
  }
}

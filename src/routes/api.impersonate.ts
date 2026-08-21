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
          // 1. Validar que el cliente sea dueño de este tenant y obtener las URLs
          const { bot_status_url, dashboard_url } = await assertClientOwnsTenant(clientId, tenantSlug);

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

          // Construir la URL de redirección final de forma dinámica
          let finalRedirectTo = redirectTo;
          if (!finalRedirectTo) {
            const host = bot_status_url
              ? deriveHost(bot_status_url)
              : dashboard_url
                ? deriveHost(dashboard_url)
                : "https://wiltech-bot.fly.dev";
            finalRedirectTo = `${host}/?tenant=${tenantSlug}&api=${host}`;
          }

          // 5. Generar enlace de ingreso de un solo uso (magiclink)
          // Usamos "http://localhost:3000" para que Supabase acepte la redirección por defecto y no falle
          const { data: linkData, error: linkError } = await messagingAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: {
              redirectTo: "http://localhost:3000",
            },
          });

          if (linkError || !linkData?.properties?.action_link) {
            throw new Error(linkError?.message || "No se pudo generar el enlace de impersonación.");
          }

          const actionLink = linkData.properties.action_link;

          // 6. Hacer petición GET al actionLink con redirección manual para capturar los tokens
          let finalLink = "";
          try {
            const verifyRes = await fetch(actionLink, {
              method: "GET",
              redirect: "manual",
            });

            const locationHeader = verifyRes.headers.get("location");
            if (locationHeader && locationHeader.includes("#")) {
              const hashIndex = locationHeader.indexOf("#");
              const hashFragment = locationHeader.substring(hashIndex);
              finalLink = `${finalRedirectTo}${hashFragment}`;
            } else {
              throw new Error("No se recibió la cabecera de redirección con el token de acceso.");
            }
          } catch (verifyErr) {
            console.error("[Impersonate] Fallo en la verificación en servidor:", verifyErr);
            throw new Error(`Error en el intercambio de tokens de sesión: ${verifyErr instanceof Error ? verifyErr.message : "Desconocido"}`);
          }

          return Response.json({ ok: true, url: finalLink });
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

function deriveHost(url: string | null): string {
  if (!url) return "https://wiltech-bot.fly.dev";
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return "https://wiltech-bot.fly.dev";
  }
}

async function resolveTenantId(messagingAdmin: MessagingAdmin, tenantSlug: string) {
  const { data, error } = await messagingAdmin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
  if (error || !data?.id) throw new Error(`No existe el tenant ${tenantSlug}.`);
  return data.id as string;
}

async function assertClientOwnsTenant(
  clientId: string,
  tenantSlug: string
): Promise<{ bot_status_url?: string | null; dashboard_url?: string | null }> {
  const [{ data: bot, error: botError }, { data: dashboard, error: dashboardError }] = await Promise.all([
    supabaseAdmin
      .from("client_bots")
      .select("id, bot_status_url")
      .eq("client_id", clientId)
      .eq("slug", tenantSlug)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("client_dashboards")
      .select("id, url")
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
  return {
    bot_status_url: bot?.bot_status_url,
    dashboard_url: dashboard?.url,
  };
}

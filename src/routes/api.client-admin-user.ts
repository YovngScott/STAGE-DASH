import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MESSAGING_SUPABASE_URL =
  process.env.STAGE_MESSAGING_SUPABASE_URL || "https://vulyyztktylldfnuvzbn.supabase.co";

interface DashboardUserBody {
  clientId?: string;
  tenantSlug?: string;
  userId?: string;
  email?: string;
  password?: string;
  displayName?: string;
}

// This project intentionally does not share generated database types with the
// separate messaging Supabase project. Keep that boundary explicit here.
type MessagingAdmin = any;

/**
 * Owner-only management for the accounts that can log into a customer's
 * dashboard. This is deliberately server-side: the messaging service-role key
 * is never sent to the Owner Console browser.
 */
export const Route = createFileRoute("/api/client-admin-user")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;

        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId")?.trim() || "";
        const tenantSlug = normalizeSlug(url.searchParams.get("tenantSlug"));
        if (!clientId || !tenantSlug) {
          return Response.json({ error: "Faltan clientId o tenantSlug." }, { status: 400 });
        }

        try {
          const messagingAdmin = getMessagingAdmin();
          const tenantId = await resolveTenantId(messagingAdmin, tenantSlug);
          const { data: memberships, error } = await messagingAdmin
            .from("tenant_admins")
            .select("user_id")
            .eq("tenant_id", tenantId);
          if (error) throw new Error(error.message);

          const usersById = await listAuthUsers(messagingAdmin);
          const users = (memberships ?? []).flatMap((membership: { user_id: string }) => {
            const user = usersById.get(membership.user_id);
            if (!user) return [];
            return [{
              id: user.id,
              email: user.email ?? "",
              displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "",
              createdAt: user.created_at ?? null,
              lastSignInAt: user.last_sign_in_at ?? null,
            }];
          });
          return Response.json({ ok: true, users });
        } catch (error) {
          return Response.json({ error: messageFrom(error) }, { status: 502 });
        }
      },

      POST: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;
        const body = await parseBody(request);
        if (body instanceof Response) return body;

        const clientId = String(body.clientId ?? "").trim();
        const tenantSlug = normalizeSlug(body.tenantSlug);
        const email = normalizeEmail(body.email);
        const password = String(body.password ?? "").trim();
        if (!clientId || !tenantSlug || !email || password.length < 8) {
          return Response.json(
            { error: "Faltan clientId, tenantSlug, email o password de al menos 8 caracteres." },
            { status: 400 },
          );
        }

        try {
          const messagingAdmin = getMessagingAdmin();
          const tenantId = await resolveTenantId(messagingAdmin, tenantSlug);
          const displayName = String(body.displayName ?? "").trim();
          const created = await messagingAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: displayName },
          });

          let user = created.data.user;
          if (created.error) {
            // "Create" is also the safe way to grant an existing account
            // access to another customer. Supabase does not return that user
            // on a duplicate email, so find it explicitly before continuing.
            if (!isDuplicateUserError(created.error.message)) throw new Error(created.error.message);
            user = await findAuthUserByEmail(messagingAdmin, email);
            if (!user) throw new Error("La cuenta ya existe, pero no se pudo recuperar para darle acceso.");
          }
          if (!user?.id) throw new Error("No se pudo crear la cuenta del dashboard.");

          const { error: membershipError } = await messagingAdmin
            .from("tenant_admins")
            .upsert({ user_id: user.id, tenant_id: tenantId }, { onConflict: "user_id,tenant_id" });
          if (membershipError) throw new Error(membershipError.message);

          await trackClientAccount({ clientId, userId: user.id, email, displayName });
          return Response.json({ ok: true, user: serializeAuthUser(user) });
        } catch (error) {
          return Response.json({ error: messageFrom(error) }, { status: 502 });
        }
      },

      PATCH: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;
        const body = await parseBody(request);
        if (body instanceof Response) return body;

        const clientId = String(body.clientId ?? "").trim();
        const tenantSlug = normalizeSlug(body.tenantSlug);
        const userId = String(body.userId ?? "").trim();
        const email = normalizeEmail(body.email);
        const password = String(body.password ?? "").trim();
        if (!clientId || !tenantSlug || !userId || !email || (password && password.length < 8)) {
          return Response.json({ error: "Datos de usuario inválidos." }, { status: 400 });
        }

        try {
          const messagingAdmin = getMessagingAdmin();
          const tenantId = await resolveTenantId(messagingAdmin, tenantSlug);
          await assertTenantMembership(messagingAdmin, tenantId, userId);
          const displayName = String(body.displayName ?? "").trim();
          const update: Record<string, unknown> = {
            email,
            email_confirm: true,
            user_metadata: { display_name: displayName },
          };
          if (password) update.password = password;
          const { data, error } = await messagingAdmin.auth.admin.updateUserById(userId, update);
          if (error || !data.user) throw new Error(error?.message ?? "No se pudo actualizar el usuario.");

          await supabaseAdmin.from("client_email_accounts").delete().eq("client_id", clientId).eq("auth_user_id", userId);
          await trackClientAccount({ clientId, userId, email, displayName });
          return Response.json({ ok: true, user: serializeAuthUser(data.user) });
        } catch (error) {
          return Response.json({ error: messageFrom(error) }, { status: 502 });
        }
      },

      DELETE: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;
        const body = await parseBody(request);
        if (body instanceof Response) return body;

        const clientId = String(body.clientId ?? "").trim();
        const tenantSlug = normalizeSlug(body.tenantSlug);
        const userId = String(body.userId ?? "").trim();
        if (!clientId || !tenantSlug || !userId) {
          return Response.json({ error: "Faltan clientId, tenantSlug o userId." }, { status: 400 });
        }

        try {
          const messagingAdmin = getMessagingAdmin();
          const tenantId = await resolveTenantId(messagingAdmin, tenantSlug);
          await assertTenantMembership(messagingAdmin, tenantId, userId);
          const { error: revokeError } = await messagingAdmin
            .from("tenant_admins")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("user_id", userId);
          if (revokeError) throw new Error(revokeError.message);

          const { data: otherMemberships, error: membershipError } = await messagingAdmin
            .from("tenant_admins")
            .select("tenant_id")
            .eq("user_id", userId)
            .limit(1);
          if (membershipError) throw new Error(membershipError.message);
          const deletedAccount = (otherMemberships ?? []).length === 0;
          if (deletedAccount) {
            const { error: deleteError } = await messagingAdmin.auth.admin.deleteUser(userId);
            if (deleteError) throw new Error(deleteError.message);
          }
          await supabaseAdmin.from("client_email_accounts").delete().eq("client_id", clientId).eq("auth_user_id", userId);
          return Response.json({ ok: true, deletedAccount });
        } catch (error) {
          return Response.json({ error: messageFrom(error) }, { status: 502 });
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

async function parseBody(request: Request): Promise<DashboardUserBody | Response> {
  try {
    return await request.json();
  } catch {
    return Response.json({ error: "Body inválido." }, { status: 400 });
  }
}

function getMessagingAdmin(): MessagingAdmin {
  const key = process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY para administrar usuarios de bots.");
  return createClient(MESSAGING_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveTenantId(messagingAdmin: MessagingAdmin, tenantSlug: string) {
  const { data, error } = await messagingAdmin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
  if (error || !data?.id) throw new Error(`No existe el tenant ${tenantSlug}.`);
  return data.id as string;
}

async function assertTenantMembership(messagingAdmin: MessagingAdmin, tenantId: string, userId: string) {
  const { data, error } = await messagingAdmin
    .from("tenant_admins")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("El usuario no tiene acceso a este dashboard.");
}

async function listAuthUsers(messagingAdmin: MessagingAdmin) {
  const users = new Map<string, any>();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await messagingAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const user of (data.users ?? []) as any[]) users.set(user.id, user);
    if ((data.users ?? []).length < 1000) break;
  }
  return users;
}

async function findAuthUserByEmail(messagingAdmin: MessagingAdmin, email: string) {
  const users = await listAuthUsers(messagingAdmin);
  return [...users.values()].find((user) => String(user.email ?? "").toLowerCase() === email) ?? null;
}

async function trackClientAccount(args: { clientId: string; userId: string; email: string; displayName: string }) {
  const payload = {
    client_id: args.clientId,
    email: args.email,
    display_name: args.displayName || null,
    provider: "supabase-auth",
    status: "active",
    auth_user_id: args.userId,
  };

  // The current schema has a functional unique index on lower(email), not a
  // Postgres unique constraint. PostgREST cannot target that index with
  // `onConflict=email`, so reconcile the tracking row explicitly instead.
  const { data: existing, error: findError } = await supabaseAdmin
    .from("client_email_accounts")
    .select("id")
    .ilike("email", args.email)
    .maybeSingle();
  if (findError) throw new Error(`No se pudo revisar la cuenta en Client Manager: ${findError.message}`);

  const result = existing?.id
    ? await supabaseAdmin.from("client_email_accounts").update(payload).eq("id", existing.id)
    : await supabaseAdmin.from("client_email_accounts").insert(payload);
  if (result.error) throw new Error(`No se pudo registrar la cuenta en Client Manager: ${result.error.message}`);
}

function serializeAuthUser(user: any) {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "",
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSlug(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isDuplicateUserError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered");
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación de usuarios.";
}

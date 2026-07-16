import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";
const MESSAGING_SUPABASE_URL = process.env.STAGE_MESSAGING_SUPABASE_URL || "https://vulyyztktylldfnuvzbn.supabase.co";

type LifecycleAction = "decommissionBot" | "decommissionClient" | "deleteBot" | "deleteClient";
type MessagingAdmin = any;

interface LifecycleBody {
  action?: LifecycleAction;
  clientId?: string;
  botId?: string;
  confirmation?: string;
}

interface ManagedBot {
  id: string | null;
  clientId: string;
  slug: string;
  name: string;
  statusUrl: string | null;
  secret: string | null;
}

/**
 * Owner-only lifecycle endpoint. Browser code never sees Fly, GitHub,
 * platform, or messaging-Supabase credentials. Destructive actions are
 * purposely sequenced and scoped to one client/tenant at a time.
 */
export const Route = createFileRoute("/api/bot-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ownerError = await requireOwner(request);
        if (ownerError) return ownerError;
        const body = await request.json().catch(() => null) as LifecycleBody | null;
        if (!body?.action || !body.clientId) return Response.json({ error: "Faltan action o clientId." }, { status: 400 });

        try {
          if (body.action === "decommissionClient") {
            const result = await decommissionClient(body.clientId);
            return Response.json({ ok: true, ...result });
          }
          if (body.action === "decommissionBot") {
            const result = await decommissionOneBot(body.clientId, String(body.botId ?? ""));
            return Response.json({ ok: true, ...result });
          }
          if (body.action === "deleteBot") {
            const result = await deleteOneBot(body.clientId, String(body.botId ?? ""), String(body.confirmation ?? ""));
            return Response.json({ ok: true, ...result });
          }
          if (body.action === "deleteClient") {
            const result = await deleteOneClient(body.clientId, String(body.confirmation ?? ""));
            return Response.json({ ok: true, ...result });
          }
          return Response.json({ error: "Acción inválida." }, { status: 400 });
        } catch (error) {
          console.error("[bot-lifecycle]", error);
          return Response.json({ error: messageFrom(error) }, { status: 502 });
        }
      },
    },
  },
});

async function decommissionClient(clientId: string) {
  const client = await getClient(clientId);
  const bots = await getClientBots(client);
  if (bots.length === 0) throw new Error("Este cliente no tiene bots para dar de baja.");

  const revokedUsers = new Set<string>();
  for (const bot of bots) {
    await disconnectRemoteBot(bot);
    for (const email of await revokeTenantAccess(bot.slug)) revokedUsers.add(email);
    await markBotPaused(bot);
  }

  const { error: accountsError } = await supabaseAdmin
    .from("client_email_accounts")
    .delete()
    .eq("client_id", client.id);
  if (accountsError) throw new Error(`No se pudieron eliminar los accesos locales: ${accountsError.message}`);

  const { error: clientError } = await supabaseAdmin
    .from("clients")
    .update({ status: "paused", bot_activo: false })
    .eq("id", client.id);
  if (clientError) throw new Error(`No se pudo marcar el cliente como pausado: ${clientError.message}`);

  return { action: "decommissioned", bots: bots.map((bot) => bot.slug), revokedUsers: [...revokedUsers] };
}

async function decommissionOneBot(clientId: string, botId: string) {
  const client = await getClient(clientId);
  const bot = await getBotForClient(client, botId);
  await disconnectRemoteBot(bot);
  const revokedUsers = await revokeTenantAccess(bot.slug);
  await markBotPaused(bot);
  const remaining = await getClientBots(client);
  const stillActive = remaining.some((candidate) => candidate.id !== bot.id && candidate.statusUrl);
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ bot_activo: stillActive })
    .eq("id", client.id);
  if (error) throw new Error(`No se pudo actualizar el cliente: ${error.message}`);
  return { action: "decommissioned", bots: [bot.slug], revokedUsers };
}

async function deleteOneBot(clientId: string, rawBotId: string, confirmation: string) {
  const client = await getClient(clientId);
  const bot = await getBotForClient(client, rawBotId);
  if (confirmation !== bot.slug) {
    throw new Error(`Escribe exactamente el slug ${bot.slug} para eliminar este bot.`);
  }

  await disconnectRemoteBot(bot);
  await deleteGitHubTenant(bot.slug);
  const fly = await destroyDedicatedFlyApp(bot);
  const removedUsers = await deleteTenantData(bot.slug);
  await deleteOwnerBotRecords(client, bot, removedUsers);

  return {
    action: "botDeleted",
    slug: bot.slug,
    fly,
    removedUsers,
  };
}

async function deleteOneClient(clientId: string, confirmation: string) {
  const client = await getClient(clientId);
  const expected = `ELIMINAR ${client.company_name}`;
  if (confirmation !== expected) {
    throw new Error(`Escribe exactamente \"${expected}\" para eliminar este cliente y todos sus bots.`);
  }

  const bots = await getClientBots(client);
  const outcomes: Array<{ slug: string; fly: FlyDeleteResult; removedUsers: string[] }> = [];
  for (const bot of bots) {
    await disconnectRemoteBot(bot);
    await deleteGitHubTenant(bot.slug);
    const fly = await destroyDedicatedFlyApp(bot);
    const removedUsers = await deleteTenantData(bot.slug);
    outcomes.push({ slug: bot.slug, fly, removedUsers });
  }

  // web_apps has ON DELETE SET NULL, so it must be explicitly deleted before
  // the client row to honour the full-cleanup contract.
  const { error: webAppsError } = await supabaseAdmin.from("web_apps").delete().eq("client_id", client.id);
  if (webAppsError) throw new Error(`No se pudieron borrar las aplicaciones web del cliente: ${webAppsError.message}`);
  const { error: clientError } = await supabaseAdmin.from("clients").delete().eq("id", client.id);
  if (clientError) throw new Error(`No se pudo eliminar el cliente: ${clientError.message}`);

  return { action: "clientDeleted", client: client.company_name, bots: outcomes };
}

async function getClient(clientId: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id,company_name,bot_status_url,bot_secret,bot_activo")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`);
  if (!data) throw new Error("El cliente ya no existe.");
  return data as { id: string; company_name: string; bot_status_url: string | null; bot_secret: string | null; bot_activo: boolean };
}

async function getClientBots(client: Awaited<ReturnType<typeof getClient>>): Promise<ManagedBot[]> {
  const { data, error } = await supabaseAdmin
    .from("client_bots")
    .select("id,client_id,slug,name,bot_status_url,bot_secret")
    .eq("client_id", client.id);
  if (error) throw new Error(`No se pudieron leer los bots: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; client_id: string; slug: string; name: string; bot_status_url: string | null; bot_secret: string | null }>;
  if (rows.length) return rows.map((row) => ({ id: row.id, clientId: row.client_id, slug: row.slug, name: row.name, statusUrl: row.bot_status_url, secret: row.bot_secret }));

  // Legacy bots existed before client_bots. They remain controllable and
  // cleanable by their tenant slug, but shared Fly apps are intentionally never
  // destroyed from this fallback path.
  const slug = slugFromStatusUrl(client.bot_status_url) || knownTenantSlug(client.company_name);
  return slug && client.bot_status_url
    ? [{ id: null, clientId: client.id, slug, name: `${client.company_name} Bot`, statusUrl: client.bot_status_url, secret: client.bot_secret }]
    : [];
}

async function getBotForClient(client: Awaited<ReturnType<typeof getClient>>, botId: string) {
  const bots = await getClientBots(client);
  const bot = bots.find((candidate) => candidate.id === botId) ?? (botId === "primary" ? bots.find((candidate) => candidate.id === null) : null);
  if (!bot) throw new Error("Ese bot no pertenece a este cliente.");
  return bot;
}

async function disconnectRemoteBot(bot: ManagedBot) {
  if (!bot.statusUrl) throw new Error(`El bot ${bot.slug} no tiene endpoint configurado.`);
  const secret = process.env.STAGE_PLATFORM_ADMIN_SECRET?.trim() || bot.secret?.trim();
  if (!secret) throw new Error(`Falta PLATFORM_ADMIN_SECRET para dar de baja ${bot.slug}.`);
  const url = configUrl(bot.statusUrl, bot.slug, "decommission");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-platform-secret": secret },
    body: "{}",
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(`El bot ${bot.slug} no pudo desconectar WhatsApp (${response.status}): ${message}`);
  }
}

async function markBotPaused(bot: ManagedBot) {
  if (bot.id) {
    const { error } = await supabaseAdmin.from("client_bots").update({ status: "paused" }).eq("id", bot.id);
    if (error) throw new Error(`No se pudo pausar ${bot.slug} en Client Manager: ${error.message}`);
  }
}

async function revokeTenantAccess(slug: string): Promise<string[]> {
  const admin = getMessagingAdmin();
  const tenant = await findTenant(admin, slug);
  if (!tenant) return [];
  const { data: memberships, error } = await admin.from("tenant_admins").select("user_id").eq("tenant_id", tenant.id);
  if (error) throw new Error(`No se pudieron leer los accesos de ${slug}: ${error.message}`);
  const ids = (memberships ?? []).map((row: { user_id: string }) => row.user_id);
  if (ids.length) {
    const { error: revokeError } = await admin.from("tenant_admins").delete().eq("tenant_id", tenant.id);
    if (revokeError) throw new Error(`No se pudieron revocar los accesos de ${slug}: ${revokeError.message}`);
  }
  return deleteOrphanAuthUsers(admin, ids);
}

async function deleteTenantData(slug: string): Promise<string[]> {
  const admin = getMessagingAdmin();
  const tenant = await findTenant(admin, slug);
  if (!tenant) return [];
  const { data: memberships, error: membershipsError } = await admin.from("tenant_admins").select("user_id").eq("tenant_id", tenant.id);
  if (membershipsError) throw new Error(`No se pudieron leer los usuarios del tenant ${slug}: ${membershipsError.message}`);
  const userIds = (memberships ?? []).map((row: { user_id: string }) => row.user_id);
  // All operational tables in the messaging schema reference tenants with
  // ON DELETE CASCADE, including tenants_admins, messages, clients, catalog,
  // appointments, employees and Google OAuth tokens.
  const { error: deleteError } = await admin.from("tenants").delete().eq("id", tenant.id);
  if (deleteError) throw new Error(`No se pudo borrar el tenant ${slug}: ${deleteError.message}`);
  return deleteOrphanAuthUsers(admin, userIds);
}

async function deleteOrphanAuthUsers(admin: MessagingAdmin, userIds: string[]) {
  const deleted: string[] = [];
  for (const userId of userIds) {
    const { data: remaining, error } = await admin.from("tenant_admins").select("tenant_id").eq("user_id", userId).limit(1);
    if (error) throw new Error(`No se pudo comprobar acceso compartido: ${error.message}`);
    if ((remaining ?? []).length > 0) continue;
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(`No se pudo eliminar la cuenta de dashboard: ${deleteError.message}`);
    if (userData?.user?.email) deleted.push(userData.user.email);
  }
  return deleted;
}

async function deleteOwnerBotRecords(client: Awaited<ReturnType<typeof getClient>>, bot: ManagedBot, removedUsers: string[]) {
  const { error: dashboardsError } = await supabaseAdmin
    .from("client_dashboards")
    .delete()
    .eq("client_id", client.id)
    .eq("slug", bot.slug);
  if (dashboardsError) throw new Error(`No se pudo eliminar el dashboard registrado: ${dashboardsError.message}`);
  if (bot.id) {
    const { error: botError } = await supabaseAdmin.from("client_bots").delete().eq("id", bot.id).eq("client_id", client.id);
    if (botError) throw new Error(`No se pudo eliminar el bot de Client Manager: ${botError.message}`);
  }

  const remaining = await getClientBots(client);
  const primary = remaining[0];
  const { error: clientError } = await supabaseAdmin
    .from("clients")
    .update({
      bot_status_url: primary?.statusUrl ?? null,
      bot_secret: primary?.secret ?? null,
      bot_activo: false,
    })
    .eq("id", client.id);
  if (clientError) throw new Error(`No se pudo actualizar el cliente después de eliminar el bot: ${clientError.message}`);
  // client_email_accounts is client-level (not tenant-level). Remove only
  // accounts whose auth user was actually deleted; a shared account remains
  // tracked if it still serves another bot/customer.
  if (removedUsers.length) {
    const { error: accountsError } = await supabaseAdmin
      .from("client_email_accounts")
      .delete()
      .in("email", removedUsers);
    if (accountsError) throw new Error(`No se pudieron limpiar los accesos eliminados: ${accountsError.message}`);
  }
}

interface FlyDeleteResult { app: string | null; destroyed: boolean; sharedAppPreserved: boolean; volumesDeleted: number }

async function destroyDedicatedFlyApp(bot: ManagedBot): Promise<FlyDeleteResult> {
  const app = flyAppFromStatusUrl(bot.statusUrl);
  // Historical tenants share wiltech-bot. Deleting it would affect another
  // customer, so it is deliberately retained; the tenant/session/data are
  // still removed by the other isolated steps.
  if (!app || !app.startsWith(`stage-${bot.slug}-`)) {
    return { app, destroyed: false, sharedAppPreserved: Boolean(app), volumesDeleted: 0 };
  }
  const infra = getFlyInfra();
  const cwd = await resolveBackendDirectory();
  const env = { ...process.env, FLY_ACCESS_TOKEN: infra.token };
  // A Fly volume cannot be removed while a Machine is mounted to it. Destroy
  // the isolated app's machines first; this is safe because app has already
  // been verified as this bot's dedicated stage-<slug>-* app.
  const machines = safeJsonArray(await runFly("fly", ["machines", "list", "--app", app, "--json"], cwd, env));
  for (const machine of machines) {
    const id = typeof machine?.id === "string" ? machine.id : "";
    if (!id) continue;
    await runFly("fly", ["machines", "destroy", id, "--app", app, "--force"], cwd, env);
  }

  // Fly detaches a volume asynchronously after machine destruction. Poll its
  // attachment instead of issuing a delete that can race the detach.
  let volumes: any[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    volumes = safeJsonArray(await runFly("fly", ["volumes", "list", "--app", app, "--json"], cwd, env));
    if (volumes.every((volume) => !volume?.attached_machine_id)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  let volumesDeleted = 0;
  for (const volume of volumes) {
    const id = typeof volume?.id === "string" ? volume.id : "";
    if (!id) continue;
    if (volume?.attached_machine_id) {
      throw new Error(`Fly todavía mantiene el volumen ${id} vinculado a una máquina. Intenta de nuevo en unos segundos.`);
    }
    await runFly("fly", ["volumes", "delete", id, "--app", app, "--yes"], cwd, env);
    volumesDeleted += 1;
  }
  await runFly("fly", ["apps", "destroy", app, "--yes"], cwd, env);
  return { app, destroyed: true, sharedAppPreserved: false, volumesDeleted };
}

async function deleteGitHubTenant(slug: string) {
  const token = process.env.STAGE_GITHUB_TOKEN?.trim();
  if (!token) throw new Error("Falta STAGE_GITHUB_TOKEN; no es seguro borrar un bot sin retirar primero su tenant de GitHub.");
  const [owner, repo] = (process.env.STAGE_BOT_TEMPLATE_REPO || DEFAULT_REPO).split("/");
  const repoPath = `backend/config/tenants/${slug}.json`;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`;
  const headers = githubHeaders(token);
  const existing = await fetch(`${url}?ref=main`, { headers });
  if (existing.status === 404) return;
  if (!existing.ok) throw new Error(`GitHub no pudo leer ${repoPath} (${existing.status}).`);
  const file = await existing.json() as { sha?: string };
  if (!file.sha) throw new Error(`GitHub no devolvió el SHA de ${repoPath}.`);
  const removed = await fetch(url, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ message: `Eliminar tenant ${slug}`, sha: file.sha, branch: "main" }),
  });
  if (!removed.ok) {
    const details = await removed.json().catch(() => null) as { message?: string } | null;
    throw new Error(details?.message || `GitHub no pudo borrar ${repoPath} (${removed.status}).`);
  }
}

async function requireOwner(request: Request): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return Response.json({ error: "No autorizado." }, { status: 401 });
  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: user.user.id, _role: "owner" });
  return isOwner ? null : Response.json({ error: "No autorizado." }, { status: 401 });
}

function getMessagingAdmin(): MessagingAdmin {
  const key = process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(MESSAGING_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findTenant(admin: MessagingAdmin, slug: string) {
  const { data, error } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`No se pudo leer el tenant ${slug}: ${error.message}`);
  return data as { id: string } | null;
}

function configUrl(statusUrl: string, slug: string, action: "decommission") {
  const raw = statusUrl.trim().replace(/\/config\/bot-activo\/?$/, "").replace(/\/$/, "");
  if (/\/api\/[^/]+$/.test(raw)) return `${raw}/config/${action}`;
  return `${raw}/api/${slug}/config/${action}`;
}

function slugFromStatusUrl(value: string | null) {
  return value?.match(/\/api\/([^/]+)\/config\/bot-activo/)?.[1] ?? "";
}

function knownTenantSlug(companyName: string) {
  const name = companyName.toLowerCase();
  if (name.includes("dominguez")) return "dominguez-auto-pintura";
  if (name.includes("wiltech")) return "wiltech";
  return companyName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function flyAppFromStatusUrl(value: string | null) {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    return host.endsWith(".fly.dev") ? host.slice(0, -".fly.dev".length) : null;
  } catch {
    return null;
  }
}

function getFlyInfra() {
  const token = process.env.STAGE_FLY_API_TOKEN?.trim();
  if (!token) throw new Error("Falta STAGE_FLY_API_TOKEN; no se puede eliminar la app dedicada de Fly.");
  return { token };
}

async function resolveBackendDirectory() {
  const root = process.env.STAGE_BOT_TEMPLATE_PATH ? path.resolve(process.env.STAGE_BOT_TEMPLATE_PATH) : path.resolve(process.cwd(), "..", "Stage-Bot-Template");
  const backend = path.join(root, "backend");
  await access(path.join(backend, "Dockerfile"), constants.R_OK);
  return backend;
}

function runFly(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? new Error("No se encontró flyctl.") : error));
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(compactFlyError(output, `Fly finalizó con código ${code ?? "desconocido"}.`))));
  });
}

function safeJsonArray(value: string): any[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function githubHeaders(token: string) {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "stage-ai-labs-owner-console" };
}

function compactFlyError(output: string, fallback: string) {
  const clean = output.replace(/FlyV1\s+[A-Za-z0-9_+\/=,.-]+/g, "[token oculto]").replace(/gsk_[A-Za-z0-9]+/g, "[clave oculta]").trim();
  return clean ? clean.slice(-700) : fallback;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar el ciclo de vida del bot.";
}

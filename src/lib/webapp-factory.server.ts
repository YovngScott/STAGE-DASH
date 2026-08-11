import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface WebAppFactoryInput {
  clientId: string;
  templateId: string;
  companyName: string;
  legalName: string;
  phone: string;
  email: string;
  address: string;
  country: string;
  currency: string;
  timezone: string;
  brandPrimary: string;
  brandInk: string;
  receiptLegalText: string;
  adminEmail: string;
  adminPin: string;
}

type DeploymentRow = {
  id: string;
  client_id: string;
  template_id: string;
  template_version: string;
  state: string;
  progress: number;
  phase: string;
  config: Record<string, string>;
  repo_name: string | null;
  fly_app_name: string | null;
  supabase_project_ref: string | null;
  public_url: string | null;
  error: string | null;
};

const activeJobs = new Map<string, Promise<void>>();

export async function listWebAppTemplates() {
  const { data, error } = await supabaseAdmin
    .from("web_app_templates")
    .select("id,name,version,description,source_repo,manifest,status")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listWebAppDeployments() {
  const { data, error } = await supabaseAdmin
    .from("web_app_deployments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function startWebAppProvision(input: WebAppFactoryInput) {
  validateInput(input);
  await preflightWebAppFactory(input);
  const { data: template, error: templateError } = await supabaseAdmin
    .from("web_app_templates")
    .select("id,version,source_repo,manifest")
    .eq("id", input.templateId)
    .eq("status", "active")
    .maybeSingle();
  if (templateError || !template) throw new Error(templateError?.message || "Plantilla no encontrada.");
  const slug = sanitizeSlug(input.companyName);
  const repoName = `stage-${slug}-web`;
  const flyAppName = repoName.slice(0, 63);
  const publicConfig = {
    companyName: input.companyName,
    legalName: input.legalName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    country: input.country,
    currency: input.currency,
    timezone: input.timezone,
    brandPrimary: input.brandPrimary,
    brandInk: input.brandInk,
    receiptLegalText: input.receiptLegalText,
  };
  const { data: row, error } = await supabaseAdmin
    .from("web_app_deployments")
    .insert({
      client_id: input.clientId,
      template_id: template.id,
      template_version: template.version,
      state: "queued",
      progress: 2,
      phase: "Preparando réplica segura…",
      config: publicConfig,
      repo_name: repoName,
      fly_app_name: flyAppName,
    })
    .select("*")
    .single();
  if (error || !row) throw new Error(error?.message || "No se pudo crear el trabajo.");
  const task = runWebAppProvision(row as DeploymentRow, template.source_repo, input)
    .catch((failure) => fail(row.id, failure))
    .finally(() => activeJobs.delete(row.id));
  activeJobs.set(row.id, task);
  return row;
}

export async function preflightWebAppFactory(input: WebAppFactoryInput) {
  const missing = ["STAGE_GITHUB_TOKEN", "STAGE_FLY_API_TOKEN", "STAGE_FLY_ORG_SLUG", "STAGE_SUPABASE_MANAGEMENT_TOKEN", "STAGE_SUPABASE_ORGANIZATION_ID"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length) throw new Error(`Faltan secretos de plataforma: ${missing.join(", ")}.`);
  const managementToken = process.env.STAGE_SUPABASE_MANAGEMENT_TOKEN!;
  if (!managementToken.startsWith("sbp_")) throw new Error("El token de administración de Supabase no es válido.");
  const [github, supabase, organization, projects, fly] = await Promise.all([
    fetch("https://api.github.com/user", { headers: githubHeaders() }),
    fetch("https://api.supabase.com/v1/organizations", { headers: { authorization: `Bearer ${managementToken}` } }),
    fetch(`https://api.supabase.com/v1/organizations/${process.env.STAGE_SUPABASE_ORGANIZATION_ID}`, { headers: { authorization: `Bearer ${managementToken}` } }),
    fetch("https://api.supabase.com/v1/projects", { headers: { authorization: `Bearer ${managementToken}` } }),
    run("fly", ["apps", "list", "--json"], process.cwd(), flyEnv(), 30_000).then(() => ({ ok: true })),
  ]);
  if (!github.ok) throw new Error(`GitHub rechazó la credencial (${github.status}).`);
  if (!supabase.ok) throw new Error(`Supabase rechazó el token (${supabase.status}).`);
  if (!organization.ok || !projects.ok) throw new Error("No se pudo verificar la capacidad disponible en Supabase.");
  const organizationData = await organization.json();
  const projectData = await projects.json();
  const organizationProjects = Array.isArray(projectData) ? projectData.filter((project: any) => project.organization_id === process.env.STAGE_SUPABASE_ORGANIZATION_ID) : [];
  if (organizationData?.plan === "free" && organizationProjects.length >= 2) {
    throw new Error("Supabase Free ya tiene sus 2 proyectos activos. Stage no creará recursos huérfanos: para publicar esta réplica se necesita liberar un proyecto o activar el plan Pro.");
  }
  if (!fly.ok) throw new Error("Fly.io no está disponible.");
}

async function runWebAppProvision(row: DeploymentRow, sourceRepo: string, input: WebAppFactoryInput) {
  const managementToken = process.env.STAGE_SUPABASE_MANAGEMENT_TOKEN!;
  const [templateOwner, templateRepo] = sourceRepo.split("/");
  const targetOwner = process.env.STAGE_GITHUB_OWNER?.trim() || templateOwner;
  if (!templateOwner || !templateRepo || !targetOwner) throw new Error("Repositorio de plantilla inválido.");
  await update(row.id, 7, "Creando repositorio privado…", "running");
  const generated = await githubJson(
    `https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`,
    {
      method: "POST",
      body: JSON.stringify({ owner: targetOwner, name: row.repo_name, private: true, include_all_branches: false }),
    },
  );
  if (!generated?.full_name && generated?.message !== "Name already exists on this account") {
    throw new Error(generated?.message || "GitHub no pudo crear el repositorio.");
  }

  await update(row.id, 16, "Creando base aislada en Supabase…");
  const dbPassword = randomBytes(24).toString("base64url") + "aA1!";
  const project = await supabaseManagement(managementToken, "/v1/projects", {
    method: "POST",
    body: JSON.stringify({
      organization_id: process.env.STAGE_SUPABASE_ORGANIZATION_ID,
      name: row.fly_app_name,
      region: "us-east-1",
      plan: "free",
      db_pass: dbPassword,
    }),
  });
  const projectRef = String(project?.ref || project?.id || "");
  if (!projectRef) throw new Error(project?.message || "Supabase no devolvió el identificador del proyecto.");
  await supabaseAdmin.from("web_app_deployments").update({ supabase_project_ref: projectRef }).eq("id", row.id);
  await waitForSupabaseProject(managementToken, projectRef);

  await update(row.id, 31, "Descargando plantilla y ejecutando migraciones…");
  const sourceDir = await downloadRepository(sourceRepo);
  try {
    const sqlFiles = (await readdir(path.join(sourceDir, "sql"))).filter((name) => name.endsWith(".sql")).sort(naturalSqlOrder);
    for (const file of sqlFiles) {
      await run(
        "psql",
        ["--host", `db.${projectRef}.supabase.co`, "--port", "5432", "--username", "postgres", "--dbname", "postgres", "-v", "ON_ERROR_STOP=1", "-f", path.join(sourceDir, "sql", file)],
        sourceDir,
        { ...process.env, PGPASSWORD: dbPassword, PGSSLMODE: "require" },
        180_000,
      );
    }

    await update(row.id, 48, "Obteniendo llaves y creando administrador…");
    const keys = await supabaseManagement(managementToken, `/v1/projects/${projectRef}/api-keys?reveal=true`);
    const keyList = Array.isArray(keys) ? keys : [];
    const publishable = keyList.find((key: any) => key.type === "publishable")?.api_key || keyList.find((key: any) => key.name === "anon")?.api_key;
    const secret = keyList.find((key: any) => key.type === "secret")?.api_key || keyList.find((key: any) => key.name === "service_role")?.api_key;
    if (!publishable || !secret) throw new Error("Supabase no entregó las llaves publicable y secreta.");
    const projectUrl = `https://${projectRef}.supabase.co`;
    const loginEmail = `admin-${sanitizeSlug(input.companyName)}@${sanitizeSlug(input.companyName)}.stage.local`;
    const authResponse = await fetch(`${projectUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password: input.adminPin, email_confirm: true, user_metadata: { nombre: input.companyName, correo_contacto: input.adminEmail, rol: "administrativo_general" } }),
    });
    if (!authResponse.ok) throw new Error(`No se pudo crear el administrador (${authResponse.status}): ${(await authResponse.text()).slice(0, 300)}`);
    const authUser = await authResponse.json();
    const userId = String(authUser?.id || authUser?.user?.id || "");
    if (!userId) throw new Error("Supabase no devolvió el identificador del administrador.");
    const profileResponse = await fetch(`${projectUrl}/rest/v1/rpc/guardar_perfil_usuario`, {
      method: "POST",
      headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ p_user_id: userId, p_nombre_completo: input.companyName, p_rol: "administrativo_general", p_activo: true, p_login_email: loginEmail, p_pin: input.adminPin }),
    });
    if (!profileResponse.ok) {
      await fetch(`${projectUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: secret, authorization: `Bearer ${secret}` } }).catch(() => undefined);
      throw new Error(`No se pudo crear el perfil administrador (${profileResponse.status}): ${(await profileResponse.text()).slice(0, 300)}`);
    }

    await update(row.id, 60, "Creando aplicación optimizada en Fly.io…");
    const exists = await run("fly", ["status", "--app", row.fly_app_name!], sourceDir, flyEnv(), 30_000).then(() => true, () => false);
    if (!exists) await run("fly", ["apps", "create", row.fly_app_name!, "--org", process.env.STAGE_FLY_ORG_SLUG!], sourceDir, flyEnv());
    const runtime = {
      ...row.config,
      slug: sanitizeSlug(input.companyName),
      dataBackend: "supabase",
      supabaseUrl: projectUrl,
      supabasePublishableKey: publishable,
    };
    const secrets = [
      `STAGE_RUNTIME_CONFIG=${Buffer.from(JSON.stringify(runtime)).toString("base64url")}`,
      `SUPABASE_URL=${projectUrl}`,
      `SUPABASE_SECRET_KEY=${secret}`,
      `SUPABASE_SERVICE_ROLE_KEY=${secret}`,
      `CRON_SECRET=${randomBytes(32).toString("hex")}`,
    ];
    await run("fly", ["secrets", "import", "--app", row.fly_app_name!], sourceDir, flyEnv(), 300_000, `${secrets.join("\n")}\n`);
    await update(row.id, 73, "Construyendo y desplegando la aplicación…");
    await run("fly", ["deploy", "--app", row.fly_app_name!, "--remote-only", "--yes"], sourceDir, flyEnv(), 900_000);
    const publicUrl = `https://${row.fly_app_name}.fly.dev`;
    await waitForHealth(`${publicUrl}/api/health`);
    const releasesRaw = await run("fly", ["releases", "--app", row.fly_app_name!, "--json"], sourceDir, flyEnv(), 30_000);
    const releases = JSON.parse(releasesRaw) as Array<{ Version?: number; Status?: string }>;
    const completed = releases.filter((release) => release.Status === "complete");

    await update(row.id, 92, "Registrando acceso, health check y rollback…");
    const { data: webApp, error: webAppError } = await supabaseAdmin
      .from("web_apps")
      .insert({
        client_id: row.client_id,
        name: input.companyName,
        url: publicUrl,
        hosting_provider: "Fly.io",
        tech_stack: ["React", "Supabase", "Fly.io"],
        status: "live",
        monthly_hosting_cost: 0,
      })
      .select("id")
      .single();
    if (webAppError) throw new Error(webAppError.message);
    await supabaseAdmin.from("web_app_deployments").update({ web_app_id: webApp.id, public_url: publicUrl, current_release: completed[0]?.Version ? String(completed[0].Version) : null, previous_release: completed[1]?.Version ? String(completed[1].Version) : null, state: "live", progress: 100, phase: "Aplicación publicada y verificada", error: null, updated_at: new Date().toISOString() }).eq("id", row.id);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
}

export async function rollbackWebAppDeployment(id: string) {
  const { data: row, error } = await supabaseAdmin.from("web_app_deployments").select("id,fly_app_name,previous_release,public_url").eq("id", id).single();
  if (error || !row) throw new Error(error?.message || "Despliegue no encontrado.");
  if (!row.fly_app_name || !row.previous_release) throw new Error("Todavía no existe una versión anterior recuperable.");
  await supabaseAdmin.from("web_app_deployments").update({ state: "rolling_back", phase: "Restaurando versión anterior…" }).eq("id", id);
  try {
    await run("fly", ["releases", "rollback", row.previous_release, "--app", row.fly_app_name, "--yes"], process.cwd(), flyEnv(), 300_000);
    await waitForHealth(`${row.public_url}/api/health`);
    await supabaseAdmin.from("web_app_deployments").update({ state: "live", progress: 100, phase: `Rollback completado a v${row.previous_release}`, current_release: row.previous_release, error: null, updated_at: new Date().toISOString() }).eq("id", id);
  } catch (failure) {
    await fail(id, failure);
    throw failure;
  }
}

async function update(id: string, progress: number, phase: string, state = "running") {
  const { error } = await supabaseAdmin.from("web_app_deployments").update({ progress, phase, state, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

async function fail(id: string, error: unknown) {
  await supabaseAdmin.from("web_app_deployments").update({ state: "failed", phase: "Provisioning detenido", error: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200), updated_at: new Date().toISOString() }).eq("id", id);
}

function validateInput(input: WebAppFactoryInput) {
  if (!input.clientId || !input.templateId || !input.companyName.trim()) throw new Error("Cliente, plantilla y nombre son obligatorios.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.adminEmail)) throw new Error("Los correos no son válidos.");
  if (!/^\d{4}$/.test(input.adminPin)) throw new Error("El PIN inicial debe tener exactamente 4 dígitos.");
  if (!/^#[0-9a-f]{6}$/i.test(input.brandPrimary) || !/^#[0-9a-f]{6}$/i.test(input.brandInk)) throw new Error("Los colores de marca no son válidos.");
}

function sanitizeSlug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `cliente-${randomUUID().slice(0, 8)}`;
}

function githubHeaders() {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.STAGE_GITHUB_TOKEN}`, "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "stage-owner-console" };
}

async function githubJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { ...githubHeaders(), ...init.headers }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 422) throw new Error(body?.message || `GitHub respondió ${response.status}.`);
  return body;
}

async function supabaseManagement(token: string, endpoint: string, options: { method?: string; body?: string; timeoutMs?: number } = {}) {
  const response = await fetch(`https://api.supabase.com${endpoint}`, { method: options.method || "GET", headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}) }, body: options.body, signal: AbortSignal.timeout(options.timeoutMs || 30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || `Supabase Management API respondió ${response.status}.`);
  return body;
}

async function waitForSupabaseProject(token: string, ref: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const project = await supabaseManagement(token, `/v1/projects/${ref}`);
    if (["ACTIVE_HEALTHY", "ACTIVE"].includes(project?.status)) return;
    if (["INACTIVE", "REMOVED", "PAUSED"].includes(project?.status)) throw new Error(`Supabase quedó en estado ${project.status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Supabase no estuvo listo dentro del tiempo esperado.");
}

async function downloadRepository(repo: string) {
  const dir = path.join(tmpdir(), `stage-web-template-${randomUUID()}`);
  const archive = path.join(tmpdir(), `stage-web-template-${randomUUID()}.tar.gz`);
  await mkdir(dir, { recursive: true });
  const response = await fetch(`https://api.github.com/repos/${repo}/tarball/main`, { headers: githubHeaders(), redirect: "follow" });
  if (!response.ok) throw new Error(`No se pudo descargar la plantilla (${response.status}).`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  try {
    await run("tar", ["-xzf", archive, "--strip-components=1", "-C", dir], dir, process.env);
  } finally {
    await rm(archive, { force: true });
  }
  return dir;
}

function naturalSqlOrder(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function flyEnv() {
  return { ...process.env, FLY_ACCESS_TOKEN: process.env.STAGE_FLY_API_TOKEN };
}

function run(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 15 * 60_000, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, windowsHide: true });
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${binary} excedió el tiempo máximo.`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.stdin.end(stdin);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(output.trim().slice(-1000) || `${binary} terminó con código ${code}.`)); });
  });
}

async function waitForHealth(url: string) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (response.ok && (await response.json().catch(() => null))?.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("La aplicación no superó el health check.");
}

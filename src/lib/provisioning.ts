import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BotBehavior } from "@/lib/bot-prompts";

export type BotKind = "assistant" | "messaging" | "voice";
export type ProvisionState = "queued" | "running" | "complete" | "failed";

/**
 * Configuración del asistente virtual. La captura el Bot Builder al crear el
 * bot y viaja al `tenant.json` versionado en GitHub — nunca se escribe a mano.
 */
/** Proveedores de correo que el asistente sabe manejar. */
export type ProveedorCorreo = "gmail" | "microsoft" | "imap";

export interface AsistenteConfigDraft {
  /** Bandeja que el asistente va a triar. */
  correo: string;
  /**
   * Con qué servicio está esa bandeja. Solo decide qué adaptador usa el
   * backend: el triaje, los borradores y el envío funcionan igual con los tres.
   */
  proveedor: ProveedorCorreo;
  /** WhatsApp del ejecutivo para las alertas de baja confianza. */
  whatsappAlertas: string;
  /** Confidence gate: por debajo de esto, decide una persona. */
  umbralConfianza: number;
  /** Cadencia del polling de Gmail, en minutos. */
  intervaloMinutos: number;
  /** Hora local del reporte de fin de día (HH:mm). */
  horaReporte: string;
  /**
   * true → los borradores se redactan en primera persona a nombre del titular,
   * sin mencionar que hay un asistente. Es seguro porque el asistente solo
   * puede CREAR borradores: nada sale del buzón sin que el titular lo envíe.
   * false → el asistente se identifica como tal al escribir.
   */
  actuaComoTitular: boolean;
  /** Nombre con el que firma cuando actuaComoTitular está activo. */
  nombreTitular: string;
  /**
   * true  → lo rutinario se responde Y SE ENVÍA solo; lo crítico y lo ambiguo
   *         quedan como borrador con aviso al titular.
   * false → nunca envía: todo queda en borradores.
   */
  enviarAutomatico: boolean;
}

export interface TenantConfigDraft {
  slug: string;
  /** Tipo de bot; el backend arranca el módulo de asistente solo si es "assistant". */
  kind: BotKind;
  nombreBot: string;
  nombre: string;
  descripcion: string;
  direccion: string;
  horario: string;
  contacto: string;
  redes: Record<string, never>;
  servicios: string[];
  moneda: string;
  zonaHoraria: string;
  adminEmails: string[];
  behavior?: BotBehavior;
  companyInfo?: string;
  extraInstructions?: string;
  promptExtra: string;
  googleCalendarId: string;
  /** Presente solo cuando kind === "assistant". */
  asistente?: AsistenteConfigDraft;
}

export interface ProvisionInput {
  clientId: string;
  clientName: string;
  slug: string;
  kind: BotKind;
  productName: string | null;
  tenantConfig: TenantConfigDraft;
  githubCommitUrl: string | null;
  dashboardUrl: string;
  groqModel: string;
  groqApiKey?: string;
}

export interface ProvisionJob {
  id: string;
  state: ProvisionState;
  progress: number;
  phase: string;
  error: string | null;
  appName: string;
  clientId: string;
  slug: string;
  botStatusUrl: string;
  dashboardUrl: string;
  botId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedeployBotInput {
  appName: string;
  slug: string;
  kind: BotKind;
  tenantConfig: TenantConfigDraft;
}

type JobsStore = Map<string, ProvisionJob>;

const globalStore = globalThis as typeof globalThis & { __stageProvisioningJobs?: JobsStore };
const jobs = globalStore.__stageProvisioningJobs ?? new Map<string, ProvisionJob>();
globalStore.__stageProvisioningJobs = jobs;

const FLY_REGION = "ewr";

export function startProvision(input: ProvisionInput): ProvisionJob {
  const id = randomUUID();
  const appName = makeFlyAppName(input.slug, input.kind);
  const dashboardUrl = buildDashboardUrl(input.dashboardUrl, input.slug, appName);
  const now = new Date().toISOString();
  const job: ProvisionJob = {
    id,
    state: "queued",
    progress: 2,
    phase: "Preparando el bot…",
    error: null,
    appName,
    clientId: input.clientId,
    slug: input.slug,
    botStatusUrl: `https://${appName}.fly.dev/api/${input.slug}/config/bot-activo`,
    dashboardUrl,
    botId: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  void runProvision(job, input).catch((error) => {
    fail(job, error instanceof Error ? error.message : "El provisioning falló por un error inesperado.");
  });

  return job;
}

export function getProvisionJob(id: string): ProvisionJob | null {
  return jobs.get(id) ?? null;
}

/** Rebuilds a live bot after changing the tenant configuration in GitHub. */
export async function redeployBotConfig(input: RedeployBotInput): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.appName)) {
    throw new Error("La app de Fly asociada al bot no es válida.");
  }
  const infra = readInfrastructure();
  const backendDir = await resolveBackendDirectory();
  const flyEnv = { ...process.env, FLY_ACCESS_TOKEN: infra.flyToken };
  const tenantPath = path.join(backendDir, "config", "tenants", `${input.slug}.json`);
  const previousTenant = await readOptionalFile(tenantPath);
  const dedicatedApp = input.appName.startsWith("stage-");
  const flyConfigPath = dedicatedApp ? path.join(backendDir, `.stage-redeploy-${randomUUID()}.toml`) : path.join(backendDir, "fly.toml");

  try {
    await writeFile(tenantPath, `${JSON.stringify(input.tenantConfig, null, 2)}\n`, "utf8");
    if (dedicatedApp) {
      const currentModel = await readFlyModel(input.appName, backendDir, flyEnv);
      await writeFile(flyConfigPath, flyToml(input.appName, input.slug, currentModel), "utf8");
    }
    await runCommand("fly", ["deploy", "--config", flyConfigPath, "--remote-only", "--yes"], backendDir, flyEnv);
  } finally {
    await restoreOptionalFile(tenantPath, previousTenant);
    if (dedicatedApp) await rm(flyConfigPath, { force: true });
  }
  await waitForHealth(`https://${input.appName}.fly.dev/health`);
}

function update(job: ProvisionJob, values: Partial<Omit<ProvisionJob, "id" | "createdAt">>) {
  Object.assign(job, values, { updatedAt: new Date().toISOString() });
}

function fail(job: ProvisionJob, error: string) {
  update(job, { state: "failed", phase: "Provisioning detenido", error, progress: Math.min(job.progress, 99) });
  if (job.botId) {
    void supabaseAdmin.from("client_bots").update({ status: "error" }).eq("id", job.botId);
  }
}

async function runProvision(job: ProvisionJob, input: ProvisionInput) {
  const infra = readInfrastructure(input.groqApiKey);
  update(job, { state: "running", progress: 8, phase: "Registrando recursos del cliente…" });

  const { data: bot, error: botError } = await supabaseAdmin
    .from("client_bots")
    .upsert(
      {
        client_id: input.clientId,
        name: input.tenantConfig.nombreBot,
        slug: input.slug,
        kind: input.kind,
        product_name: input.productName,
        status: "draft",
        bot_status_url: job.botStatusUrl,
        bot_secret: infra.platformSecret,
        dashboard_url: job.dashboardUrl,
        github_commit_url: input.githubCommitUrl,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .maybeSingle();
  if (botError) throw new Error(`No se pudo registrar el bot del cliente: ${botError.message}`);
  job.botId = bot?.id ?? null;

  const { data: existingDashboard, error: dashboardLookupError } = await supabaseAdmin
    .from("client_dashboards")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("slug", input.slug)
    .maybeSingle();
  if (dashboardLookupError) throw new Error(`No se pudo revisar el dashboard del cliente: ${dashboardLookupError.message}`);

  const dashboardData = {
    client_id: input.clientId,
    bot_id: job.botId,
    name: `${input.tenantConfig.nombre} Dashboard`,
    slug: input.slug,
    url: job.dashboardUrl,
    provider: "local",
    status: "draft",
  };
  const dashboardResult = existingDashboard
    ? await supabaseAdmin.from("client_dashboards").update(dashboardData).eq("id", existingDashboard.id)
    : await supabaseAdmin.from("client_dashboards").insert(dashboardData);
  if (dashboardResult.error) throw new Error(`No se pudo registrar el dashboard del cliente: ${dashboardResult.error.message}`);

  await supabaseAdmin
    .from("clients")
    .update({
      bot_status_url: job.botStatusUrl,
      bot_secret: infra.platformSecret,
      bot_activo: true,
    })
    .eq("id", input.clientId);

  update(job, { progress: 20, phase: "Creando la app dedicada en Fly.io…" });
  const backendDir = await resolveBackendDirectory();
  const flyEnv = { ...process.env, FLY_ACCESS_TOKEN: infra.flyToken };

  const appExists = await commandSucceeds("fly", ["status", "--app", job.appName], backendDir, flyEnv);
  if (!appExists) {
    await runCommand("fly", ["apps", "create", job.appName, "--org", infra.flyOrg], backendDir, flyEnv);
  }

  update(job, { progress: 32, phase: "Preparando volumen y secretos seguros…" });
  const volumes = await runCommand("fly", ["volumes", "list", "--app", job.appName, "--json"], backendDir, flyEnv);
  const hasVolume = safeJsonArray(volumes).some((volume: any) => volume?.name === "bot_data");
  if (!hasVolume) {
    await runCommand(
      "fly",
      ["volumes", "create", "bot_data", "--app", job.appName, "--region", FLY_REGION, "--size", "1", "--yes"],
      backendDir,
      flyEnv,
    );
  }

  await runCommand(
    "fly",
    [
      "secrets",
      "set",
      `SUPABASE_URL=${infra.messagingSupabaseUrl}`,
      `SUPABASE_SERVICE_ROLE_KEY=${infra.messagingSupabaseServiceRoleKey}`,
      `GROQ_API_KEY=${infra.groqApiKey}`,
      `PLATFORM_ADMIN_SECRET=${infra.platformSecret}`,
      "--app",
      job.appName,
    ],
    backendDir,
    flyEnv,
  );

  update(job, { progress: 48, phase: "Construyendo y desplegando el bot…" });
  const tenantPath = path.join(backendDir, "config", "tenants", `${input.slug}.json`);
  const flyConfigPath = path.join(backendDir, `.stage-provision-${job.id}.toml`);
  const existingTenant = await readOptionalFile(tenantPath);

  try {
    await writeFile(tenantPath, `${JSON.stringify(input.tenantConfig, null, 2)}\n`, "utf8");
    await writeFile(flyConfigPath, flyToml(job.appName, input.slug, input.groqModel), "utf8");
    await runCommand("fly", ["deploy", "--config", flyConfigPath, "--remote-only", "--yes"], backendDir, flyEnv);
  } finally {
    await restoreOptionalFile(tenantPath, existingTenant);
    await rm(flyConfigPath, { force: true });
  }

  update(job, { progress: 78, phase: "Esperando confirmación de salud del bot…" });
  await waitForHealth(`https://${job.appName}.fly.dev/health`);

  update(job, { progress: 90, phase: "Activando el bot y preparando el QR…" });
  const activation = await fetch(job.botStatusUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-platform-secret": infra.platformSecret },
    body: JSON.stringify({ activo: true }),
  });
  if (!activation.ok) throw new Error(`La app se desplegó, pero no se pudo activar el bot (${activation.status}).`);

  if (job.botId) {
    const { error } = await supabaseAdmin.from("client_bots").update({ status: "active" }).eq("id", job.botId);
    if (error) throw new Error(`El bot se desplegó, pero no se pudo marcar activo: ${error.message}`);
  }
  const { error: dashboardError } = await supabaseAdmin
    .from("client_dashboards")
    .update({ status: "live" })
    .eq("client_id", input.clientId)
    .eq("slug", input.slug);
  if (dashboardError) throw new Error(`El bot se desplegó, pero no se pudo activar su dashboard: ${dashboardError.message}`);

  update(job, {
    state: "complete",
    progress: 100,
    phase: "Bot desplegado. Crea un usuario del dashboard y después abre el QR para conectar WhatsApp.",
    error: null,
  });
}

function buildDashboardUrl(baseUrl: string, slug: string, appName: string) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("tenant", slug);
    url.searchParams.set("api", `https://${appName}.fly.dev`);
    return url.toString();
  } catch {
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}tenant=${encodeURIComponent(slug)}&api=${encodeURIComponent(`https://${appName}.fly.dev`)}`;
  }
}

function readInfrastructure(groqOverride?: string) {
  const needed = [
    "STAGE_FLY_API_TOKEN",
    "STAGE_FLY_ORG_SLUG",
    "STAGE_DEFAULT_GROQ_API_KEY",
    "STAGE_MESSAGING_SUPABASE_URL",
    "STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY",
    "STAGE_PLATFORM_ADMIN_SECRET",
  ] as const;
  const missing = needed.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Faltan variables locales: ${missing.join(", ")}. Reinicia el Owner Console.`);

  return {
    flyToken: process.env.STAGE_FLY_API_TOKEN!,
    flyOrg: process.env.STAGE_FLY_ORG_SLUG!,
    groqApiKey: groqOverride?.trim() || process.env.STAGE_DEFAULT_GROQ_API_KEY!,
    messagingSupabaseUrl: process.env.STAGE_MESSAGING_SUPABASE_URL!,
    messagingSupabaseServiceRoleKey: process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY!,
    platformSecret: process.env.STAGE_PLATFORM_ADMIN_SECRET!,
  };
}

async function resolveBackendDirectory() {
  const configured = process.env.STAGE_BOT_TEMPLATE_PATH;
  const templateRoot = configured ? path.resolve(configured) : path.resolve(process.cwd(), "..", "Stage-Bot-Template");
  const backendDir = path.join(templateRoot, "backend");
  try {
    await access(path.join(backendDir, "Dockerfile"), constants.R_OK);
  } catch {
    throw new Error("No se encontró Stage-Bot-Template. Define STAGE_BOT_TEMPLATE_PATH con la carpeta local del template.");
  }
  return backendDir;
}

function makeFlyAppName(slug: string, kind: BotKind) {
  return `stage-${slug}-${kind}`
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function flyToml(appName: string, slug: string, model: string) {
  return `app = '${appName}'
primary_region = '${FLY_REGION}'

[build]
  dockerfile = 'Dockerfile'

[env]
  BAILEYS_AUTH_DIR = '/data/.baileys_auth'
  PORT = '8080'
  AI_PROVIDER = 'groq'
  GROQ_MODEL = '${model.replace(/'/g, "")}'
  TENANT_SLUGS = '${slug}'

[[mounts]]
  source = 'bot_data'
  destination = '/data'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = '30s'
    timeout = '5s'
    grace_period = '90s'
    method = 'GET'
    path = '/health'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '512mb'
  cpus = 1
  memory_mb = 512
`;
}

async function commandSucceeds(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  try {
    await runCommand(binary, args, cwd, env);
    return true;
  } catch {
    return false;
  }
}

function runCommand(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, windowsHide: true });
    let output = "";
    child.stdout.on("data", (data) => { output += String(data); });
    child.stderr.on("data", (data) => { output += String(data); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") reject(new Error("No se encontró flyctl. Instala Fly.io CLI y asegúrate de que el comando fly funcione en PowerShell."));
      else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(compactCommandError(output, `Fly terminó con código ${code ?? "desconocido"}.`)));
    });
  });
}

function compactCommandError(output: string, fallback: string) {
  const clean = output
    .replace(/FlyV1\s+[A-Za-z0-9_+\/=,.-]+/g, "[token oculto]")
    .replace(/gsk_[A-Za-z0-9]+/g, "[clave Groq oculta]")
    .trim();
  return clean ? clean.slice(-800) : fallback;
}

function safeJsonArray(value: string): any[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readFlyModel(appName: string, cwd: string, env: NodeJS.ProcessEnv) {
  try {
    const machines = safeJsonArray(await runCommand("fly", ["machines", "list", "--app", appName, "--json"], cwd, env));
    const model = machines[0]?.config?.env?.GROQ_MODEL;
    return typeof model === "string" && model.trim() ? model.trim() : "meta-llama/llama-4-scout-17b-16e-instruct";
  } catch {
    return "meta-llama/llama-4-scout-17b-16e-instruct";
  }
}

async function readOptionalFile(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreOptionalFile(file: string, original: string | null) {
  if (original === null) await rm(file, { force: true });
  else await writeFile(file, original, "utf8");
}

async function waitForHealth(url: string) {
  let lastError = "";
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.ok) return;
      }
      lastError = `Health respondió ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "No se pudo consultar health.";
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`La app no superó el health check: ${lastError}`);
}

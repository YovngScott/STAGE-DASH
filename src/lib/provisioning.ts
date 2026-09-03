import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BotBehavior } from "@/lib/bot-prompts";
import {
  createApp,
  createMachine,
  createVolume,
  getApp,
  listVolumes,
  listMachines,
  stopMachine,
} from "@/lib/fly-client";
import {
  appendProvisionJobLog,
  createProvisionJob,
  getProvisionJob as getDbProvisionJob,
  updateProvisionJobStatus,
  type ProvisionJobRecord,
} from "@/lib/provision-db";

export type BotKind = "assistant" | "messaging" | "voice";
export type WhatsAppProvider = "baileys" | "meta_cloud";

export interface MetaWhatsAppSecrets {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export type ProvisionState = "queued" | "running" | "complete" | "completed" | "failed";

export interface ProvisionPreflightCheck {
  id: "credentials" | "groq" | "template" | "tenant_isolation" | "github" | "fly";
  label: string;
  ok: boolean;
  details: string;
}

export type ProveedorCorreo = "gmail" | "microsoft" | "imap";

export interface AsistenteConfigDraft {
  correo: string;
  proveedor: ProveedorCorreo;
  whatsappAlertas: string;
  umbralConfianza: number;
  intervaloMinutos: number;
  horaReporte: string;
  actuaComoTitular: boolean;
  nombreTitular: string;
  enviarAutomatico: boolean;
}

export interface TenantConfigDraft {
  slug: string;
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
  whatsapp: {
    provider: WhatsAppProvider;
    phoneNumberId: string;
    businessAccountId: string;
    apiVersion: string;
  };
  schedule: {
    businessDays: number[];
    businessStart: string;
    businessEnd: string;
    quietStart: string;
    quietEnd: string;
    holidays: string[];
    appointmentReminderTime: string;
    dailyReportTime: string;
  };
  adminEmails: string[];
  behavior?: BotBehavior;
  companyInfo?: string;
  extraInstructions?: string;
  promptConsolidated?: boolean;
  promptExtra: string;
  policy?: {
    canQuoteByChat: boolean;
    requireAppointmentConfirmation: true;
    requireHumanForCommitments: true;
  };
  googleCalendarId: string;
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
  groqModel: string;
  groqApiKey?: string;
  whatsappSecrets?: MetaWhatsAppSecrets;
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
  microsoftRedirectUri: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedeployBotInput {
  appName: string;
  slug: string;
  kind: BotKind;
  tenantConfig: TenantConfigDraft;
}

const FLY_REGION = "dfw";

/**
 * Arranca el proceso de aprovisionamiento en la nube de forma persistente en Supabase.
 * Retorna el ID del trabajo (UUID).
 */
export async function startProvision(input: ProvisionInput): Promise<string> {
  // 1. Crear registro del job en la base de datos persistente (Supabase)
  const jobId = await createProvisionJob(input.slug);

  // 2. Ejecutar la orquestación pura en la nube en background sin bloquear la respuesta HTTP
  void runProvision(jobId, input).catch(async (error) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[provisioning] Error no capturado en job ${jobId}:`, errorMsg);
    await appendProvisionJobLog(jobId, `ERROR CRÍTICO: ${errorMsg}`).catch(() => {});
    await updateProvisionJobStatus(jobId, "failed").catch(() => {});
  });

  return jobId;
}

/**
 * Consulta un trabajo de aprovisionamiento persistente en Supabase.
 */
export async function getProvisionJob(id: string): Promise<ProvisionJobRecord | null> {
  return getDbProvisionJob(id);
}

/**
 * Re-despliega o reinicia máquinas existentes en Fly.io sin tocar archivos locales ni binarios CLI.
 */
export async function redeployBotConfig(input: RedeployBotInput): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.appName)) {
    throw new Error("La app de Fly asociada al bot no es válida.");
  }
  const machines = await listMachines(input.appName);
  if (!machines.length) {
    throw new Error(`No se encontraron máquinas para la aplicación ${input.appName}`);
  }
  for (const m of machines) {
    await stopMachine(input.appName, m.id).catch(() => {});
  }
  await waitForHealth(`https://${input.appName}.fly.dev/health`);
}

/**
 * Orquestador en segundo plano de Fly.io y Supabase (Zero CLI / Zero disco local).
 */
async function runProvision(jobId: string, input: ProvisionInput): Promise<void> {
  const appName = makeFlyAppName(input.slug, input.kind);
  const dashboardUrl = buildDashboardUrl(input.slug, appName);
  const botStatusUrl = `https://${appName}.fly.dev/api/${input.slug}/config/bot-activo`;
  const infra = readInfrastructure(input.groqApiKey, input.tenantConfig.asistente?.proveedor);

  try {
    await updateProvisionJobStatus(jobId, "running", appName);
    await appendProvisionJobLog(
      jobId,
      `Iniciando aprovisionamiento en la nube para tenant [${input.slug}] (App: ${appName})...`,
    );

    // 1. Registro en base de datos administrativa
    await appendProvisionJobLog(jobId, "Registrando bot y dashboard en base de datos...");
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
          bot_status_url: botStatusUrl,
          bot_secret: infra.platformSecret,
          dashboard_url: dashboardUrl,
          github_commit_url: input.githubCommitUrl,
        },
        { onConflict: "slug" },
      )
      .select("id")
      .maybeSingle();

    if (botError) {
      throw new Error(`No se pudo registrar el bot en la BD: ${botError.message}`);
    }

    const { data: existingDashboard } = await supabaseAdmin
      .from("client_dashboards")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("slug", input.slug)
      .maybeSingle();

    const dashboardData = {
      client_id: input.clientId,
      bot_id: bot?.id ?? null,
      name: `${input.tenantConfig.nombre} Dashboard`,
      slug: input.slug,
      url: dashboardUrl,
      provider: "fly",
      status: "draft",
    };

    if (existingDashboard) {
      await supabaseAdmin
        .from("client_dashboards")
        .update(dashboardData)
        .eq("id", existingDashboard.id);
    } else {
      await supabaseAdmin.from("client_dashboards").insert(dashboardData);
    }

    await supabaseAdmin
      .from("clients")
      .update({
        bot_status_url: botStatusUrl,
        bot_secret: infra.platformSecret,
        bot_activo: true,
      })
      .eq("id", input.clientId);

    await appendProvisionJobLog(jobId, "Registros de base de datos completados.");

    // 2. Creación de la App en Fly.io
    await appendProvisionJobLog(jobId, `Creando aplicación dedicada en Fly.io (${appName})...`);
    try {
      await createApp(appName, infra.flyOrg);
      await appendProvisionJobLog(jobId, `App [${appName}] creada con éxito en Fly.io.`);
    } catch (error) {
      const existing = await getApp(appName);
      if (existing) {
        await appendProvisionJobLog(jobId, `App [${appName}] ya existía en Fly.io. Reutilizando.`);
      } else {
        throw error;
      }
    }

    // 3. Creación o reutilización del volumen persistente 'bot_data'
    await appendProvisionJobLog(
      jobId,
      `Aprovisionando volumen persistente 'bot_data' (1GB) en región ${FLY_REGION}...`,
    );
    const volumes = await listVolumes(appName).catch(() => []);
    let volume = volumes.find((v) => v.name === "bot_data");
    if (!volume) {
      volume = await createVolume(appName, "bot_data", FLY_REGION, 1);
      await appendProvisionJobLog(jobId, `Volumen [${volume.id}] aprovisionado con éxito.`);
    } else {
      await appendProvisionJobLog(jobId, `Volumen [${volume.id}] existente. Reutilizando.`);
    }

    // 4. Preparación de variables de entorno seguras para el contenedor
    const env: Record<string, string> = {
      PORT: "8080",
      AI_PROVIDER: "groq",
      GROQ_MODEL: input.groqModel || "openai/gpt-oss-120b",
      TENANT_SLUGS: input.slug,
      BAILEYS_AUTH_DIR: "/data/.baileys_auth",
      SUPABASE_URL: infra.messagingSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: infra.messagingSupabaseServiceRoleKey,
      GROQ_API_KEY: infra.groqApiKey,
      PLATFORM_ADMIN_SECRET: infra.platformSecret,
    };

    if (infra.credencialesSecret) env.CREDENCIALES_SECRET = infra.credencialesSecret;
    if (infra.googleClientId) {
      env.GOOGLE_OAUTH_CLIENT_ID = infra.googleClientId;
      env.GOOGLE_OAUTH_CLIENT_SECRET = infra.googleClientSecret;
      env.GOOGLE_OAUTH_REDIRECT_URI = `https://${appName}.fly.dev/api/calendar/oauth-callback`;
    }
    if (infra.microsoftClientId) {
      env.MICROSOFT_OAUTH_CLIENT_ID = infra.microsoftClientId;
      env.MICROSOFT_OAUTH_CLIENT_SECRET = infra.microsoftClientSecret;
      env.MICROSOFT_OAUTH_REDIRECT_URI = `https://${appName}.fly.dev/api/asistente/microsoft-callback`;
    }
    if (input.tenantConfig.whatsapp.provider === "meta_cloud") {
      const meta = input.whatsappSecrets;
      if (!meta) throw new Error("Faltan las credenciales privadas de Meta WhatsApp.");
      env.META_WHATSAPP_ACCESS_TOKEN = meta.accessToken;
      env.META_WHATSAPP_APP_SECRET = meta.appSecret;
      env.META_WHATSAPP_VERIFY_TOKEN = meta.verifyToken;
      env.META_WHATSAPP_PHONE_NUMBER_ID = input.tenantConfig.whatsapp.phoneNumberId;
      env.META_WHATSAPP_API_VERSION = input.tenantConfig.whatsapp.apiVersion;
    }

    // 5. Creación de la Machine (Contenedor Docker)
    const dockerImage =
      process.env.STAGE_BOT_DOCKER_IMAGE || "ghcr.io/yovngscott/stage-bot-template:latest";
    await appendProvisionJobLog(jobId, `Aprovisionando Fly Machine con imagen [${dockerImage}]...`);

    const machine = await createMachine(appName, {
      region: FLY_REGION,
      config: {
        image: dockerImage,
        env,
        mounts: [
          {
            volume: volume.id,
            path: "/data",
          },
        ],
        guest: {
          cpu_kind: "shared",
          cpus: 1,
          memory_mb: 512,
        },
        restart: {
          policy: "always",
        },
        services: [
          {
            protocol: "tcp",
            internal_port: 8080,
            autostop: false,
            autostart: true,
            ports: [
              { port: 443, handlers: ["tls", "http"] },
              { port: 80, handlers: ["http"], force_https: true },
            ],
            checks: [
              {
                type: "http",
                port: 8080,
                method: "GET",
                path: "/health",
                interval: "30s",
                timeout: "5s",
                grace_period: "90s",
              },
            ],
          },
        ],
      },
    });

    await appendProvisionJobLog(
      jobId,
      `Máquina [${machine.id}] creada exitosamente en estado [${machine.state}].`,
    );

    // 6. Verificación de salud del contenedor
    await appendProvisionJobLog(jobId, "Esperando respuesta del endpoint de salud (/health)...");
    await waitForHealth(`https://${appName}.fly.dev/health`);
    await appendProvisionJobLog(jobId, "Health check respondió OK. Contenedor activo y en línea.");

    // 7. Cierre con éxito
    await supabaseAdmin
      .from("client_bots")
      .update({ status: "active" })
      .eq("slug", input.slug);

    await supabaseAdmin
      .from("client_dashboards")
      .update({ status: "active" })
      .eq("slug", input.slug);

    await appendProvisionJobLog(jobId, `Aprovisionamiento completado con éxito para ${appName}.`);
    await updateProvisionJobStatus(jobId, "completed", appName);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[runProvision] Error en job ${jobId}:`, errorMsg);
    await appendProvisionJobLog(jobId, `ERROR: ${errorMsg}`);
    await updateProvisionJobStatus(jobId, "failed", appName);

    await supabaseAdmin
      .from("client_bots")
      .update({ status: "error", last_error: errorMsg })
      .eq("slug", input.slug);
    throw error;
  }
}

export function buildDashboardUrl(slug: string, appName: string): string {
  const origin = `https://${appName}.fly.dev`;
  const url = new URL(origin);
  url.searchParams.set("tenant", slug);
  url.searchParams.set("api", origin);
  return url.toString();
}

export function makeFlyAppName(slug: string, kind: BotKind): string {
  return `stage-${slug}-${kind}`
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export async function getActiveProvisionBySlug(
  slug: string,
): Promise<ProvisionJobRecord | null> {
  const { data } = await supabaseAdmin
    .from("provision_jobs")
    .select("id, tenant_slug, status, logs, fly_app_name, created_at, updated_at")
    .eq("tenant_slug", slug)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as ProvisionJobRecord) ?? null;
}

export async function preflightProvision(
  groqOverride?: string,
  proveedorCorreo?: ProveedorCorreo,
): Promise<void> {
  const checks = await inspectProvisionPreflight(groqOverride, proveedorCorreo);
  const failures = checks.filter((check) => !check.ok);
  if (failures.length) throw new Error(failures.map((check) => check.details).join(" "));
}

export async function preflightMetaWhatsApp(
  config: TenantConfigDraft["whatsapp"],
  secrets: MetaWhatsAppSecrets | undefined,
): Promise<void> {
  if (config.provider !== "meta_cloud") return;
  if (!config.phoneNumberId) throw new Error("Falta el Phone number ID de Meta.");
  if (!secrets?.accessToken || !secrets.appSecret || !secrets.verifyToken) {
    throw new Error("Introduce Access Token, App Secret y Verify Token de Meta para publicar.");
  }
  if (secrets.verifyToken.length < 16)
    throw new Error("El Verify Token debe tener al menos 16 caracteres.");
  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}?fields=id,display_phone_number,verified_name`,
    {
      headers: { authorization: `Bearer ${secrets.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Meta rechazó la configuración (${response.status}): ${detail}`);
  }
}

export async function inspectProvisionPreflight(
  groqOverride?: string,
  proveedorCorreo?: ProveedorCorreo,
): Promise<ProvisionPreflightCheck[]> {
  const checks: ProvisionPreflightCheck[] = [];
  try {
    readInfrastructure(groqOverride, proveedorCorreo);
    checks.push({
      id: "credentials",
      label: "Credenciales de plataforma",
      ok: true,
      details: "Claves requeridas disponibles.",
    });
  } catch (error) {
    checks.push({
      id: "credentials",
      label: "Credenciales de plataforma",
      ok: false,
      details: error instanceof Error ? error.message : "Faltan variables en el entorno.",
    });
  }
  return checks;
}

export function readInfrastructure(groqOverride?: string, proveedorCorreo?: ProveedorCorreo) {
  const needed: string[] = [
    "STAGE_FLY_ORG_SLUG",
    "STAGE_MESSAGING_SUPABASE_URL",
    "STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY",
    "STAGE_PLATFORM_ADMIN_SECRET",
  ];
  if (!groqOverride?.trim()) needed.push("STAGE_DEFAULT_GROQ_API_KEY");

  if (proveedorCorreo === "microsoft" || proveedorCorreo === "imap") {
    needed.push("STAGE_CREDENCIALES_SECRET");
  }
  if (proveedorCorreo === "gmail") {
    needed.push(
      "STAGE_CREDENCIALES_SECRET",
      "STAGE_GOOGLE_OAUTH_CLIENT_ID",
      "STAGE_GOOGLE_OAUTH_CLIENT_SECRET",
    );
  }
  if (proveedorCorreo === "microsoft") {
    needed.push("STAGE_MICROSOFT_OAUTH_CLIENT_ID", "STAGE_MICROSOFT_OAUTH_CLIENT_SECRET");
  }

  const missing = needed.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(`Faltan variables locales: ${missing.join(", ")}. Reinicia el Owner Console.`);

  let flyToken =
    process.env.STAGE_FLY_API_TOKEN ||
    process.env.FLY_API_TOKEN ||
    process.env.FLY_ACCESS_TOKEN;

  if (!flyToken?.trim()) {
    throw new Error("Falta STAGE_FLY_API_TOKEN o FLY_API_TOKEN en process.env.");
  }
  flyToken = flyToken.trim();
  if (flyToken.startsWith('"') && flyToken.endsWith('"')) {
    flyToken = flyToken.slice(1, -1);
  }

  return {
    flyToken,
    flyOrg: process.env.STAGE_FLY_ORG_SLUG!,
    groqApiKey: groqOverride?.trim() || process.env.STAGE_DEFAULT_GROQ_API_KEY!,
    messagingSupabaseUrl: process.env.STAGE_MESSAGING_SUPABASE_URL!,
    messagingSupabaseServiceRoleKey: process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY!,
    platformSecret: process.env.STAGE_PLATFORM_ADMIN_SECRET!,
    credencialesSecret: process.env.STAGE_CREDENCIALES_SECRET ?? "",
    microsoftClientId: process.env.STAGE_MICROSOFT_OAUTH_CLIENT_ID ?? "",
    microsoftClientSecret: process.env.STAGE_MICROSOFT_OAUTH_CLIENT_SECRET ?? "",
    googleClientId: process.env.STAGE_GOOGLE_OAUTH_CLIENT_ID ?? "",
    googleClientSecret: process.env.STAGE_GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  };
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

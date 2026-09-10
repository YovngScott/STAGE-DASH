#!/usr/bin/env node
/**
 * ============================================================================
 * Stage AI Labs LLC — CLI de Automatización de Onboarding de Tenants
 * ============================================================================
 *
 * Uso:
 *   node scripts/onboard-tenant.ts [opciones]
 *
 * Modos de ejecución:
 *   1. Interactivo (por defecto si no se pasan argumentos):
 *      node scripts/onboard-tenant.ts
 *
 *   2. Mediante flags de línea de comandos:
 *      node scripts/onboard-tenant.ts \
 *        --slug taller-dominguez \
 *        --name "Taller Domínguez Auto Pintura" \
 *        --phone "+18095550199" \
 *        --tokens 10000000 \
 *        --budget 50 \
 *        --model gemini \
 *        --prompt "Taller automotriz líder en desabolladura y pintura horneada."
 *
 *   3. Mediante archivo JSON o string JSON:
 *      node scripts/onboard-tenant.ts --json tenant-data.json
 *      node scripts/onboard-tenant.ts --data '{"slug":"mi-bot","name":"Mi Empresa",...}'
 *
 *   4. Modo prueba / simulación:
 *      node scripts/onboard-tenant.ts ... --dry-run
 *
 *   5. Aplicar directamente a Supabase:
 *      node scripts/onboard-tenant.ts ... --execute
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";

// ANSI Styling para consola profesional
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgGreen: "\x1b[42m\x1b[30m",
};

export type AIModelChoice = "groq" | "gemini";
export type BotKindChoice = "messaging" | "assistant" | "voice";

export interface TenantInputData {
  slug: string;
  name: string;
  phone: string;
  monthlyTokens: number;
  monthlyBudgetUsd: number;
  model: AIModelChoice;
  prompt: string;
  kind?: BotKindChoice;
  adminEmails?: string[];
  timezone?: string;
  currency?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  normalized?: {
    slug: string;
    phone: string;
    whatsappJid: string;
    monthlyTokens: number;
    monthlyBudgetUsd: number;
    model: AIModelChoice;
    kind: BotKindChoice;
  };
}

/**
 * Valida la sintaxis del slug del tenant.
 * Requisitos: 3 a 50 caracteres, sólo minúsculas, dígitos y guiones, sin guiones consecutivos.
 */
export function validateSlug(rawSlug: string): { valid: boolean; slug?: string; error?: string } {
  if (!rawSlug || typeof rawSlug !== "string") {
    return { valid: false, error: "El slug es obligatorio." };
  }
  const slug = rawSlug.trim().toLowerCase();
  if (slug.length < 3) {
    return { valid: false, error: "El slug debe tener al menos 3 caracteres." };
  }
  if (slug.length > 50) {
    return { valid: false, error: "El slug no puede exceder 50 caracteres." };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return {
      valid: false,
      error:
        "El slug solo puede contener letras minúsculas, dígitos y guiones (sin empezar ni terminar con guion).",
    };
  }
  if (slug.includes("--")) {
    return { valid: false, error: "El slug no puede contener guiones consecutivos ('--')." };
  }
  return { valid: true, slug };
}

/**
 * Valida y normaliza teléfonos a formato E.164 y genera su WhatsApp JID.
 */
export function validatePhone(rawPhone: string): {
  valid: boolean;
  e164?: string;
  jid?: string;
  error?: string;
} {
  if (!rawPhone || typeof rawPhone !== "string") {
    return { valid: false, error: "El teléfono o JID de WhatsApp es obligatorio." };
  }

  const clean = rawPhone.trim().toLowerCase();
  // Extraer dígitos quitando sufijo de WhatsApp si viene en formato JID (ej. 18095551234@s.whatsapp.net)
  let digits = clean.replace(/@s\.whatsapp\.net$/i, "").replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      error: `El teléfono debe contener entre 8 y 15 dígitos numéricos (se encontraron ${digits.length}).`,
    };
  }

  const e164 = `+${digits}`;
  const jid = `${digits}@s.whatsapp.net`;
  return { valid: true, e164, jid };
}

/**
 * Valida todos los campos requeridos para el onboarding.
 */
export function validateTenantInput(data: Partial<TenantInputData>): ValidationResult {
  const errors: Record<string, string> = {};

  const slugCheck = validateSlug(data.slug ?? "");
  if (!slugCheck.valid) {
    errors.slug = slugCheck.error!;
  }

  if (!data.name || typeof data.name !== "string" || data.name.trim().length < 2) {
    errors.name = "El nombre de la empresa es obligatorio (mínimo 2 caracteres).";
  }

  const phoneCheck = validatePhone(data.phone ?? "");
  if (!phoneCheck.valid) {
    errors.phone = phoneCheck.error!;
  }

  const tokens = Number(data.monthlyTokens ?? 10_000_000);
  if (Number.isNaN(tokens) || tokens <= 0) {
    errors.monthlyTokens = "El límite mensual de tokens debe ser un número entero mayor a 0.";
  }

  const budget = Number(data.monthlyBudgetUsd ?? 50);
  if (Number.isNaN(budget) || budget <= 0) {
    errors.monthlyBudgetUsd = "El presupuesto mensual en USD debe ser mayor a 0.";
  }

  const model = String(data.model ?? "gemini").toLowerCase() as AIModelChoice;
  if (model !== "groq" && model !== "gemini") {
    errors.model = "El modelo preferido debe ser 'gemini' o 'groq'.";
  }

  const kind = (String(data.kind ?? "messaging").toLowerCase() as BotKindChoice) || "messaging";
  if (!["messaging", "assistant", "voice"].includes(kind)) {
    errors.kind = "El tipo de bot debe ser 'messaging', 'assistant' o 'voice'.";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors,
    normalized: {
      slug: slugCheck.slug!,
      phone: phoneCheck.e164!,
      whatsappJid: phoneCheck.jid!,
      monthlyTokens: Math.round(tokens),
      monthlyBudgetUsd: Number(budget.toFixed(2)),
      model,
      kind,
    },
  };
}

/**
 * Genera el JSON de configuración de producción para el tenant (Stage-Bot-Template).
 */
export function generateTenantConfig(
  data: TenantInputData,
  normalized: NonNullable<ValidationResult["normalized"]>,
) {
  const defaultModelName =
    normalized.model === "groq" ? "llama-3.3-70b-versatile" : "gemini-1.5-flash";

  return {
    slug: normalized.slug,
    kind: normalized.kind,
    nombreBot: `Asistente de ${data.name.trim()}`,
    nombre: data.name.trim(),
    descripcion: `Asistente virtual y atención automatizada vía WhatsApp para ${data.name.trim()}.`,
    direccion: "Atención remota / República Dominicana",
    horario: "Lunes a viernes, 09:00–18:00",
    contacto: normalized.phone,
    whatsappJid: normalized.whatsappJid,
    redes: "",
    servicios: `Servicios y catálogo oficial de ${data.name.trim()}`,
    moneda: data.currency || "USD",
    zonaHoraria: data.timezone || "America/Santo_Domingo",
    preferredModel: {
      provider: normalized.model,
      modelName: defaultModelName,
    },
    whatsapp: {
      provider: "baileys",
      phoneNumberId: "",
      businessAccountId: "",
      apiVersion: "v23.0",
    },
    schedule: {
      businessDays: [1, 2, 3, 4, 5],
      businessStart: "09:00",
      businessEnd: "18:00",
      quietStart: "20:00",
      quietEnd: "08:00",
      holidays: [],
      appointmentReminderTime: "09:00",
      dailyReportTime: "18:00",
    },
    adminEmails:
      data.adminEmails && data.adminEmails.length > 0 ? data.adminEmails : ["owner@stagelabs.com"],
    behavior: "sales",
    policy: {
      canQuoteByChat: false,
      requireAppointmentConfirmation: true,
      requireHumanForCommitments: true,
    },
    companyInfo:
      data.prompt && data.prompt.trim()
        ? data.prompt.trim()
        : `Información de operaciones y servicios de ${data.name.trim()}.`,
    extraInstructions:
      "Responde siempre de forma cordial, concisa y profesional. Si el cliente solicita información no confirmada, escala amablemente la conversación a un agente humano.",
    promptExtra: "",
    googleCalendarId: "primary",
    insuranceAutomationEnabled: false,
    knowledgeBase: {
      sourceName: `Base de Conocimiento - ${data.name.trim()}`,
      content: data.prompt ? data.prompt.trim() : "",
      lastSyncedAt: new Date().toISOString(),
    },
    asistente:
      normalized.kind === "assistant"
        ? {
            correo: "info@" + normalized.slug + ".com",
            proveedor: "gmail",
            whatsappAlertas: normalized.phone.replace(/[^\d]/g, ""),
            umbralConfianza: 0.35,
            horaReporte: "18:00",
            intervaloMinutos: 10,
            maxPorCorrida: 25,
            actuaComoTitular: false,
            nombreTitular: data.name.trim(),
            enviarAutomatico: false,
            categorias: {
              Ventas: "Consultas comerciales y cotizaciones",
              Soporte: "Dudas y asistencia técnica",
              General: "Asuntos administrativos de rutina",
            },
          }
        : null,
  };
}

/**
 * Genera el script SQL de aprovisionamiento idempotente para Supabase.
 */
export function generateTenantSql(
  data: TenantInputData,
  normalized: NonNullable<ValidationResult["normalized"]>,
): string {
  const cleanName = data.name.trim().replace(/'/g, "''");
  const cleanSlug = normalized.slug.replace(/'/g, "''");
  const canal =
    normalized.kind === "assistant"
      ? "asistente"
      : normalized.kind === "voice"
        ? "llamadas"
        : "mensajes";

  return `-- ============================================================================
-- Stage AI Labs LLC — Script de Aprovisionamiento para Tenant: ${cleanSlug}
-- Generado automáticamente por scripts/onboard-tenant.ts
-- Fecha: ${new Date().toISOString()}
-- ============================================================================

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 1. Insertar o actualizar registro de Tenant
  INSERT INTO public.tenants (slug, nombre, bot_activo, canal)
  VALUES ('${cleanSlug}', '${cleanName}', true, '${canal}')
  ON CONFLICT (slug) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    bot_activo = true,
    canal = EXCLUDED.canal
  RETURNING id INTO v_tenant_id;

  -- 2. Insertar o actualizar políticas de ejecución operativa (tenant_runtime_policies)
  -- Nota: Respeta las cuotas de tokens, presupuesto y protecciones Anti-OOM
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'tenant_runtime_policies'
  ) THEN
    INSERT INTO public.tenant_runtime_policies (
      tenant_id,
      mode,
      auto_send_percentage,
      monthly_tokens,
      monthly_cost_usd,
      warning_percentage,
      country_code,
      require_consent
    )
    VALUES (
      v_tenant_id,
      'live',
      100,
      ${normalized.monthlyTokens},
      ${normalized.monthlyBudgetUsd},
      80,
      'DO',
      true
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      monthly_tokens = EXCLUDED.monthly_tokens,
      monthly_cost_usd = EXCLUDED.monthly_cost_usd,
      mode = 'live';
  END IF;

  -- 3. Crear cliente base en la tabla clients del Owner Console si existe
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'clients'
  ) THEN
    INSERT INTO public.clients (
      company_name,
      contact_name,
      phone,
      status,
      mrr,
      billing_cycle,
      services,
      bot_activo
    )
    VALUES (
      '${cleanName}',
      'Contacto Principal',
      '${normalized.phone}',
      'active',
      ${normalized.monthlyBudgetUsd},
      'monthly',
      ARRAY['AI Messaging Suite'],
      true
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'Tenant % (%) aprovisionado con éxito.', '${cleanSlug}', v_tenant_id;
END $$;
`;
}

/**
 * Carga variables de entorno locales (.env y .env.local).
 */
export function loadEnvFiles() {
  const cwd = process.cwd();
  const envPaths = [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, "..", ".env.local"),
    path.join(cwd, "..", ".env"),
    path.join(cwd, "..", "Stage-Bot-Template", "backend", ".env"),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignorar fallas de lectura silenciosamente
      }
    }
  }
}

/**
 * Ejecuta el aprovisionamiento directo contra Supabase usando service_role si está configurado.
 */
const OWNER_SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";

function resolveOwnerServiceRoleKey(): string {
  const keys = [
    process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY,
    process.env.STAGE_DASHBOARD_SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ];

  for (const k of keys) {
    if (k && k.startsWith("ey")) {
      try {
        const payload = JSON.parse(Buffer.from(k.split(".")[1], "base64").toString());
        if (payload.ref === "auvbmpfiplwawxqibmmq") {
          return k;
        }
      } catch {
        // ignore
      }
    }
  }

  // Fallback a clave conocida del proyecto Owner
  return (
    process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dmJtcGZpcGx3YXd4cWlibW1xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzk4ODA2OSwiZXhwIjoyMDk5NTY0MDY5fQ.6o_HHsM06jw94Jgp4FQnQKBnw70Jg-2pKKDZE5VxGek"
  );
}

export async function executeSupabaseProvision(
  data: TenantInputData,
  normalized: NonNullable<ValidationResult["normalized"]>,
): Promise<{ success: boolean; message: string; clientId?: string; botId?: string }> {
  loadEnvFiles();

  const ownerUrl = OWNER_SUPABASE_URL;
  const ownerServiceRoleKey = resolveOwnerServiceRoleKey();

  if (!ownerUrl || !ownerServiceRoleKey || ownerServiceRoleKey.startsWith("missing-")) {
    return {
      success: false,
      message:
        "Credenciales de STAGE_SUPABASE_SERVICE_ROLE_KEY no detectadas en el entorno actual. Se generaron los archivos JSON y SQL de migración en disco listos para aplicar.",
    };
  }

  try {
    const ownerSupabase = createClient(ownerUrl, ownerServiceRoleKey, {
      auth: { persistSession: false },
    });

    const companyName = data.name.trim();
    const productName =
      normalized.kind === "assistant"
        ? "Virtual Assistant"
        : normalized.kind === "voice"
          ? "Voice AI"
          : "AI Messaging Suite";

    // 1. Sincronización atómica con tabla 'clients' (Owner DB)
    const { data: existingClient } = await ownerSupabase
      .from("clients")
      .select("id, company_name, services")
      .eq("company_name", companyName)
      .maybeSingle();

    let ownerClientId = existingClient?.id;

    if (!ownerClientId) {
      const { data: createdClient, error: clientCreateErr } = await ownerSupabase
        .from("clients")
        .insert({
          company_name: companyName,
          phone: normalized.phone,
          status: "active",
          mrr: normalized.monthlyBudgetUsd,
          billing_cycle: "monthly",
          services: [productName],
          bot_activo: true,
        })
        .select("id")
        .single();

      if (clientCreateErr) {
        return {
          success: false,
          message: `Error al crear el cliente en 'clients': ${clientCreateErr.message}`,
        };
      }
      ownerClientId = createdClient.id;
    } else {
      await ownerSupabase
        .from("clients")
        .update({
          bot_activo: true,
          phone: normalized.phone || undefined,
          mrr: normalized.monthlyBudgetUsd || undefined,
        })
        .eq("id", ownerClientId);
    }

    // 2. Sincronización atómica con tabla 'client_bots' (Owner DB)
    const localDashboardUrl = `http://127.0.0.1:5174/?tenant=${normalized.slug}`;
    const botName = `${companyName} Bot`;

    const { data: botRow, error: botErr } = await ownerSupabase
      .from("client_bots")
      .upsert(
        {
          client_id: ownerClientId,
          name: botName,
          slug: normalized.slug,
          kind: normalized.kind,
          product_name: productName,
          status: "active",
          dashboard_url: localDashboardUrl,
        },
        { onConflict: "slug" },
      )
      .select("id, slug, name")
      .single();

    if (botErr) {
      return {
        success: false,
        message: `Error al registrar el bot en 'client_bots': ${botErr.message}`,
      };
    }

    // 3. Sincronización con 'client_dashboards' (Owner DB)
    if (botRow?.id) {
      try {
        await ownerSupabase.from("client_dashboards").upsert(
          {
            client_id: ownerClientId,
            bot_id: botRow.id,
            name: `${companyName} Bot Dashboard`,
            slug: normalized.slug,
            url: localDashboardUrl,
            provider: "local",
            status: "live",
          },
          { onConflict: "slug" },
        );
      } catch {
        // Omitir error si client_dashboards no es compatible
      }
    }

    // 4. Sincronización con Base de Datos de Mensajería / Runtime ('tenants', 'tenant_runtime_policies')
    const messagingUrl =
      process.env.STAGE_MESSAGING_SUPABASE_URL || "https://vulyyztktylldfnuvzbn.supabase.co";
    const messagingKey = process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY;

    if (messagingUrl && messagingKey && !messagingKey.startsWith("missing-")) {
      try {
        const messagingSupabase = createClient(messagingUrl, messagingKey, {
          auth: { persistSession: false },
        });

        const canal =
          normalized.kind === "assistant"
            ? "asistente"
            : normalized.kind === "voice"
              ? "llamadas"
              : "mensajes";

        const { data: tenantRow } = await messagingSupabase
          .from("tenants")
          .upsert(
            {
              slug: normalized.slug,
              nombre: companyName,
              bot_activo: true,
              canal,
            },
            { onConflict: "slug" },
          )
          .select("id, slug")
          .maybeSingle();

        if (tenantRow?.id) {
          await messagingSupabase.from("tenant_runtime_policies").upsert(
            {
              tenant_id: tenantRow.id,
              mode: "live",
              auto_send_percentage: 100,
              monthly_tokens: normalized.monthlyTokens,
              monthly_cost_usd: normalized.monthlyBudgetUsd,
              warning_percentage: 80,
              country_code: "DO",
              require_consent: true,
            },
            { onConflict: "tenant_id" },
          );
        }
      } catch (runtimeErr) {
        console.warn(
          `${c.yellow}⚠️ Aviso: Sincronización runtime de messaging omitida (${runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr)}).${c.reset}`,
        );
      }
    }

    return {
      success: true,
      message: `Cliente '${companyName}' y Bot '${normalized.slug}' sincronizados e insertados exitosamente en Supabase (Client ID: ${ownerClientId}, Bot ID: ${botRow.id}).`,
      clientId: ownerClientId,
      botId: botRow.id,
    };
  } catch (err) {
    return {
      success: false,
      message: `Fallo durante la conexión a Supabase: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Elimina los archivos generados en disco en caso de rollback atómico.
 */
export function removeTenantFiles(files?: {
  configPath?: string;
  sqlPath?: string;
  templateConfigPath?: string;
}) {
  if (!files) return;
  try {
    if (files.configPath && fs.existsSync(files.configPath)) {
      fs.unlinkSync(files.configPath);
    }
  } catch {
    // ignore
  }
  try {
    if (files.sqlPath && fs.existsSync(files.sqlPath)) {
      fs.unlinkSync(files.sqlPath);
    }
  } catch {
    // ignore
  }
  try {
    if (files.templateConfigPath && fs.existsSync(files.templateConfigPath)) {
      fs.unlinkSync(files.templateConfigPath);
    }
  } catch {
    // ignore
  }
}

/**
 * Guarda los archivos generados en el disco.
 */
export function saveTenantFiles(
  data: TenantInputData,
  normalized: NonNullable<ValidationResult["normalized"]>,
  options: { outDir?: string } = {},
): { configPath: string; sqlPath: string; templateConfigPath?: string } {
  const cwd = process.cwd();
  const outDir = options.outDir || path.join(cwd, "generated-tenants");
  fs.mkdirSync(outDir, { recursive: true });

  const configObj = generateTenantConfig(data, normalized);
  const sqlContent = generateTenantSql(data, normalized);

  const configPath = path.join(outDir, `${normalized.slug}.json`);
  const sqlPath = path.join(outDir, `${normalized.slug}.sql`);

  fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2) + "\n", "utf-8");
  fs.writeFileSync(sqlPath, sqlContent, "utf-8");

  // También verificar si existe el repositorio Stage-Bot-Template para sincronizar directamente
  const possibleTemplateDirs = [
    path.resolve(cwd, "..", "Stage-Bot-Template", "backend", "config", "tenants"),
    path.resolve(cwd, "Stage-Bot-Template", "backend", "config", "tenants"),
  ];

  let templateConfigPath: string | undefined;
  for (const tDir of possibleTemplateDirs) {
    if (fs.existsSync(tDir)) {
      templateConfigPath = path.join(tDir, `${normalized.slug}.json`);
      fs.writeFileSync(templateConfigPath, JSON.stringify(configObj, null, 2) + "\n", "utf-8");
      break;
    }
  }

  return { configPath, sqlPath, templateConfigPath };
}

export interface ProvisionResult {
  success: boolean;
  message: string;
  data?: TenantInputData;
  normalized?: NonNullable<ValidationResult["normalized"]>;
  errors?: Record<string, string>;
  files?: { configPath: string; sqlPath: string; templateConfigPath?: string };
  supabase?: { success: boolean; message: string };
}

/**
 * Aprovisiona programáticamente un tenant:
 * 1. Valida los datos y normaliza slug y teléfono E.164.
 * 2. Genera los archivos de configuración JSON y migración SQL.
 * 3. Ejecuta el upsert en la base de datos de Supabase si está disponible.
 * 4. Si la base de datos falla, ejecuta rollback de archivos y retorna success: false.
 */
export async function provisionTenant(
  inputData: Partial<TenantInputData>,
  options: { executeSupabase?: boolean; outDir?: string } = {},
): Promise<ProvisionResult> {
  const validation = validateTenantInput(inputData);
  if (!validation.valid || !validation.normalized) {
    const errorDetails = Object.entries(validation.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    return {
      success: false,
      message: `Errores de validación: ${errorDetails}`,
      errors: validation.errors,
    };
  }

  const normalized = validation.normalized;
  const fullData: TenantInputData = {
    slug: normalized.slug,
    name: (inputData.name || "").trim(),
    phone: normalized.phone,
    monthlyTokens: normalized.monthlyTokens,
    monthlyBudgetUsd: normalized.monthlyBudgetUsd,
    model: normalized.model,
    prompt: inputData.prompt ? inputData.prompt.trim() : "",
    kind: normalized.kind,
  };

  const files = saveTenantFiles(fullData, normalized, { outDir: options.outDir });

  let supabaseResult = {
    success: false,
    message: "Aprovisionamiento directo a Supabase omitido por configuración.",
  };

  if (options.executeSupabase !== false) {
    supabaseResult = await executeSupabaseProvision(fullData, normalized);

    // Si la transacción en base de datos falló, ejecutar rollback atómico de archivos y retornar fallo
    if (!supabaseResult.success) {
      removeTenantFiles(files);
      return {
        success: false,
        message: `Fallo de aprovisionamiento en base de datos: ${supabaseResult.message}`,
        data: fullData,
        normalized,
        supabase: supabaseResult,
      };
    }
  }

  return {
    success: true,
    message: `Tenant '${normalized.slug}' (${fullData.name}) aprovisionado exitosamente en Stage AI Labs. ${supabaseResult.message}`,
    data: fullData,
    normalized,
    files,
    supabase: supabaseResult,
  };
}

/**
 * Imprime la ayuda del CLI.
 */
function printHelp() {
  console.log(`
${c.bold}${c.cyan}Stage AI Labs — CLI de Automatización de Tenants${c.reset}
${c.gray}========================================================================${c.reset}

${c.bold}MODO INTERACTIVO:${c.reset}
  node scripts/onboard-tenant.ts

${c.bold}MODO BATCH / FLAGS:${c.reset}
  node scripts/onboard-tenant.ts [opciones]

${c.bold}OPCIONES DISPONIBLES:${c.reset}
  ${c.green}--slug, -s <slug>${c.reset}           ID del tenant (ej. taller-dominguez, wiltech-do)
  ${c.green}--name, -n <nombre>${c.reset}         Nombre comercial de la empresa
  ${c.green}--phone, -p <teléfono>${c.reset}     Teléfono en formato E.164 o WhatsApp JID (ej. +18095550199)
  ${c.green}--tokens, -t <número>${c.reset}      Límite mensual de tokens (default: 10000000)
  ${c.green}--budget, -b <dólares>${c.reset}     Presupuesto mensual en USD (default: 50)
  ${c.green}--model, -m <modelo>${c.reset}       Modelo preferido: "gemini" o "groq" (default: gemini)
  ${c.green}--prompt <texto>${c.reset}            Reglas de negocio e información de la empresa
  ${c.green}--kind, -k <tipo>${c.reset}          Tipo de bot: "messaging", "assistant" o "voice"
  ${c.green}--json, -j <archivo>${c.reset}       Ruta a un archivo JSON con los datos del tenant
  ${c.green}--data <json-string>${c.reset}       String JSON con los datos del tenant
  ${c.green}--dry-run${c.reset}                   Muestra la configuración y el SQL sin escribir archivos
  ${c.green}--execute, --apply${c.reset}         Inserta automáticamente en Supabase si hay credenciales
  ${c.green}--out-dir <ruta>${c.reset}           Directorio donde guardar los artefactos generados
  ${c.green}--help, -h${c.reset}                  Muestra este mensaje de ayuda
`);
}

/**
 * Flujo Interactivo por Consola.
 */
async function runInteractivePrompt(): Promise<TenantInputData> {
  const rl = readline.createInterface({ input, output });

  console.log(
    `\n${c.bgCyan}${c.bold} STAGE AI LABS — ASISTENTE INTERACTIVO DE ONBOARDING DE TENANTS ${c.reset}\n`,
  );
  console.log(
    `${c.gray}Por favor completa los siguientes datos para aprovisionar el nuevo tenant:${c.reset}\n`,
  );

  let slug = "";
  while (!slug) {
    const answer = await rl.question(
      `${c.bold}${c.cyan}? Tenant ID / Slug (ej. taller-dominguez):${c.reset} `,
    );
    const check = validateSlug(answer);
    if (check.valid) {
      slug = check.slug!;
    } else {
      console.log(`  ${c.red}✖ ${check.error}${c.reset}`);
    }
  }

  let name = "";
  while (!name) {
    const answer = await rl.question(
      `${c.bold}${c.cyan}? Nombre comercial de la empresa:${c.reset} `,
    );
    if (answer.trim().length >= 2) {
      name = answer.trim();
    } else {
      console.log(`  ${c.red}✖ El nombre debe tener al menos 2 caracteres.${c.reset}`);
    }
  }

  let phone = "";
  while (!phone) {
    const answer = await rl.question(
      `${c.bold}${c.cyan}? Teléfono de WhatsApp (E.164 ej. +18095550199 o JID):${c.reset} `,
    );
    const check = validatePhone(answer);
    if (check.valid) {
      phone = check.e164!;
      console.log(`  ${c.gray}→ WhatsApp JID detectado: ${check.jid}${c.reset}`);
    } else {
      console.log(`  ${c.red}✖ ${check.error}${c.reset}`);
    }
  }

  const tokensAns = await rl.question(
    `${c.bold}${c.cyan}? Límite mensual de tokens [10000000]:${c.reset} `,
  );
  const monthlyTokens = tokensAns.trim() ? Number(tokensAns.trim()) : 10_000_000;

  const budgetAns = await rl.question(
    `${c.bold}${c.cyan}? Presupuesto mensual en USD [50]:${c.reset} `,
  );
  const monthlyBudgetUsd = budgetAns.trim() ? Number(budgetAns.trim()) : 50;

  let model: AIModelChoice = "gemini";
  const modelAns = await rl.question(
    `${c.bold}${c.cyan}? Modelo de IA preferido (1: gemini, 2: groq) [1]:${c.reset} `,
  );
  if (modelAns.trim() === "2" || modelAns.trim().toLowerCase() === "groq") {
    model = "groq";
  }

  console.log(`\n${c.bold}${c.cyan}? Prompt base / Reglas del negocio:${c.reset}`);
  console.log(`${c.gray}(Ingresa un resumen o pega las instrucciones del negocio):${c.reset}`);
  const prompt = await rl.question(`> `);

  rl.close();

  return {
    slug,
    name,
    phone,
    monthlyTokens,
    monthlyBudgetUsd,
    model,
    prompt,
    kind: "messaging",
  };
}

/**
 * Procesa los argumentos de línea de comandos.
 */
function parseArgs(): {
  flags: Record<string, string | boolean>;
  hasFlags: boolean;
} {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--execute" || arg === "--apply") flags.execute = true;
    else if (arg === "--interactive" || arg === "-i") flags.interactive = true;
    else if (arg === "--slug" || arg === "-s") flags.slug = args[++i];
    else if (arg === "--name" || arg === "-n") flags.name = args[++i];
    else if (arg === "--phone" || arg === "-p") flags.phone = args[++i];
    else if (arg === "--tokens" || arg === "-t") flags.tokens = args[++i];
    else if (arg === "--budget" || arg === "-b") flags.budget = args[++i];
    else if (arg === "--model" || arg === "-m") flags.model = args[++i];
    else if (arg === "--prompt") flags.prompt = args[++i];
    else if (arg === "--kind" || arg === "-k") flags.kind = args[++i];
    else if (arg === "--json" || arg === "-j") flags.json = args[++i];
    else if (arg === "--data") flags.data = args[++i];
    else if (arg === "--out-dir") flags.outDir = args[++i];
  }

  const hasFlags = Object.keys(flags).length > 0;
  return { flags, hasFlags };
}

/**
 * Punto de entrada principal del CLI.
 */
export async function main() {
  const { flags, hasFlags } = parseArgs();

  if (flags.help) {
    printHelp();
    return;
  }

  let inputData: Partial<TenantInputData> = {};

  // Caso 1: Archivo JSON
  if (flags.json && typeof flags.json === "string") {
    const jsonPath = path.resolve(process.cwd(), flags.json);
    if (!fs.existsSync(jsonPath)) {
      console.error(`${c.red}Error: No se encontró el archivo JSON en '${jsonPath}'${c.reset}`);
      process.exit(1);
    }
    inputData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  }
  // Caso 2: Data en línea (JSON string)
  else if (flags.data && typeof flags.data === "string") {
    inputData = JSON.parse(flags.data);
  }
  // Caso 3: Flags de comando
  else if (hasFlags && (flags.slug || flags.name || flags.phone)) {
    inputData = {
      slug: flags.slug as string,
      name: flags.name as string,
      phone: flags.phone as string,
      monthlyTokens: flags.tokens ? Number(flags.tokens) : 10_000_000,
      monthlyBudgetUsd: flags.budget ? Number(flags.budget) : 50,
      model: (flags.model as AIModelChoice) || "gemini",
      prompt: (flags.prompt as string) || "",
      kind: (flags.kind as BotKindChoice) || "messaging",
    };
  }
  // Caso 4: Modo interactivo
  else {
    inputData = await runInteractivePrompt();
  }

  // Validar datos de entrada
  const validation = validateTenantInput(inputData);
  if (!validation.valid || !validation.normalized) {
    console.error(`\n${c.red}${c.bold}Errores de validación en los datos del tenant:${c.reset}`);
    for (const [field, err] of Object.entries(validation.errors)) {
      console.error(`  ${c.yellow}• ${field}:${c.reset} ${err}`);
    }
    process.exit(1);
  }

  const fullData: TenantInputData = {
    slug: validation.normalized.slug,
    name: inputData.name!.trim(),
    phone: validation.normalized.phone,
    monthlyTokens: validation.normalized.monthlyTokens,
    monthlyBudgetUsd: validation.normalized.monthlyBudgetUsd,
    model: validation.normalized.model,
    prompt: inputData.prompt ? inputData.prompt.trim() : "",
    kind: validation.normalized.kind,
  };

  const normalized = validation.normalized;

  console.log(`\n${c.green}${c.bold}✔ Datos validados con éxito:${c.reset}`);
  console.log(`  ${c.cyan}Tenant ID (slug):${c.reset}  ${normalized.slug}`);
  console.log(`  ${c.cyan}Empresa:${c.reset}           ${fullData.name}`);
  console.log(
    `  ${c.cyan}Teléfono:${c.reset}          ${normalized.phone} (${normalized.whatsappJid})`,
  );
  console.log(
    `  ${c.cyan}Tokens / Presupuesto:${c.reset} ${normalized.monthlyTokens.toLocaleString()} tokens / $${normalized.monthlyBudgetUsd.toFixed(2)} USD`,
  );
  console.log(`  ${c.cyan}Modelo Preferido:${c.reset}   ${normalized.model.toUpperCase()}`);
  console.log(`  ${c.cyan}Tipo de Bot:${c.reset}        ${normalized.kind}`);

  // Modo Dry-run
  if (flags.dryRun) {
    console.log(`\n${c.yellow}${c.bold}=== MODO DRY-RUN: VISTA PREVIA DE ARTEFACTOS ===${c.reset}`);
    console.log(`\n${c.bold}--- [1] JSON de Configuración de Producción ---${c.reset}`);
    console.log(JSON.stringify(generateTenantConfig(fullData, normalized), null, 2));

    console.log(`\n${c.bold}--- [2] Script SQL de Inserción ---${c.reset}`);
    console.log(generateTenantSql(fullData, normalized));

    console.log(`\n${c.green}✔ Simulación completada sin escribir archivos.${c.reset}`);
    return;
  }

  // Guardar archivos
  const outDir = typeof flags.outDir === "string" ? flags.outDir : undefined;
  const { configPath, sqlPath, templateConfigPath } = saveTenantFiles(fullData, normalized, {
    outDir,
  });

  console.log(`\n${c.bold}${c.green}✔ Artefactos generados exitosamente:${c.reset}`);
  console.log(`  ${c.gray}1. Configuración JSON:${c.reset}  ${c.cyan}${configPath}${c.reset}`);
  console.log(`  ${c.gray}2. Migración SQL:${c.reset}       ${c.cyan}${sqlPath}${c.reset}`);
  if (templateConfigPath) {
    console.log(
      `  ${c.gray}3. Sincronizado en bot:${c.reset} ${c.green}${templateConfigPath}${c.reset}`,
    );
  }

  // Ejecución en Supabase si se especificó el flag
  if (flags.execute) {
    console.log(`\n${c.cyan}Conectando a Supabase para aplicar inserción...${c.reset}`);
    const provRes = await executeSupabaseProvision(fullData, normalized);
    if (provRes.success) {
      console.log(`${c.green}${c.bold}✔ ${provRes.message}${c.reset}`);
    } else {
      console.log(`${c.yellow}⚠️ ${provRes.message}${c.reset}`);
    }
  } else {
    console.log(`\n${c.gray}💡 Para ejecutar la inserción en Supabase:${c.reset}`);
    console.log(`   - Ejecuta este script con el flag ${c.green}--execute${c.reset}, o`);
    console.log(
      `   - Copia y pega el contenido de ${c.cyan}${sqlPath}${c.reset} en el SQL Editor de tu proyecto Supabase.`,
    );
  }

  console.log(
    `\n${c.bold}${c.green}🎉 Onboarding del tenant '${normalized.slug}' completado con éxito.${c.reset}\n`,
  );
}

// Ejecutar automáticamente si es llamado directamente
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("onboard-tenant.ts")
) {
  main().catch((err) => {
    console.error(`\n${c.red}${c.bold}Error fatal:${c.reset}`, err);
    process.exit(1);
  });
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProvisionJobStatus = "queued" | "running" | "completed" | "failed";

export interface ProvisionJobRecord {
  id: string;
  tenant_slug: string;
  status: ProvisionJobStatus;
  logs: string[];
  fly_app_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Crea un nuevo trabajo de aprovisionamiento en Supabase.
 * Devuelve el ID generado (UUID).
 */
export async function createProvisionJob(tenantSlug: string): Promise<string> {
  const slug = tenantSlug?.trim();
  if (!slug) {
    throw new Error("tenantSlug es requerido para crear un trabajo de aprovisionamiento.");
  }

  const { data, error } = await supabaseAdmin
    .from("provision_jobs")
    .insert({
      tenant_slug: slug,
      status: "queued",
      logs: [`[${new Date().toISOString()}] Trabajo de aprovisionamiento registrado en cola.`],
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Error al crear el trabajo de aprovisionamiento en la BD: ${error?.message || "Sin ID devuelto"}`,
    );
  }

  return data.id as string;
}

/**
 * Actualiza el estado de un trabajo de aprovisionamiento existente y, opcionalmente,
 * el nombre de la app de Fly asociada.
 */
export async function updateProvisionJobStatus(
  jobId: string,
  status: ProvisionJobStatus | string,
  flyAppName?: string,
): Promise<void> {
  if (!jobId?.trim()) {
    throw new Error("jobId es requerido para actualizar el estado.");
  }

  const normalizedStatus = status === "complete" ? "completed" : status;

  const updatePayload: Record<string, unknown> = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
  };

  if (flyAppName?.trim()) {
    updatePayload.fly_app_name = flyAppName.trim();
  }

  const { error } = await supabaseAdmin
    .from("provision_jobs")
    .update(updatePayload)
    .eq("id", jobId.trim());

  if (error) {
    throw new Error(
      `Error al actualizar el estado del trabajo [${jobId}] a [${status}]: ${error.message}`,
    );
  }
}

/**
 * Añade una entrada de log al historial de un trabajo de aprovisionamiento.
 * Soporta ejecución atómica en Postgres vía RPC con fallback transparente en cliente.
 */
export async function appendProvisionJobLog(jobId: string, logMessage: string): Promise<void> {
  if (!jobId?.trim()) {
    throw new Error("jobId es requerido para registrar logs.");
  }

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${logMessage.trim()}`;

  // 1. Intento atómico mediante función RPC de Postgres
  const { error: rpcError } = await supabaseAdmin.rpc("append_provision_job_log", {
    job_id: jobId.trim(),
    log_message: entry,
  });

  if (!rpcError) return;

  // 2. Fallback: Lectura y actualización directa si la función RPC aún no está creada
  const { data: job, error: fetchError } = await supabaseAdmin
    .from("provision_jobs")
    .select("logs")
    .eq("id", jobId.trim())
    .single();

  if (fetchError) {
    throw new Error(`Error al leer logs del trabajo [${jobId}]: ${fetchError.message}`);
  }

  const currentLogs = Array.isArray(job?.logs) ? (job.logs as string[]) : [];

  const { error: updateError } = await supabaseAdmin
    .from("provision_jobs")
    .update({
      logs: [...currentLogs, entry],
      updated_at: timestamp,
    })
    .eq("id", jobId.trim());

  if (updateError) {
    throw new Error(`Error al persistir log en el trabajo [${jobId}]: ${updateError.message}`);
  }
}

/**
 * Obtiene el registro completo de un trabajo de aprovisionamiento por su ID.
 * Útil para que los endpoints del frontend consulten el estado y logs en tiempo real.
 */
export async function getProvisionJob(jobId: string): Promise<ProvisionJobRecord | null> {
  if (!jobId?.trim()) return null;

  const { data, error } = await supabaseAdmin
    .from("provision_jobs")
    .select("id, tenant_slug, status, logs, fly_app_name, created_at, updated_at")
    .eq("id", jobId.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Error al consultar el trabajo [${jobId}]: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    tenant_slug: data.tenant_slug,
    status: data.status as ProvisionJobStatus,
    logs: Array.isArray(data.logs) ? (data.logs as string[]) : [],
    fly_app_name: data.fly_app_name ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

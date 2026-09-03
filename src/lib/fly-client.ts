/**
 * Cliente HTTP/REST puro para interactuar con la API de Fly Machines (v1).
 * Docs: https://api.machines.dev/v1
 */

const FLY_API_BASE = "https://api.machines.dev/v1";

export class FlyApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
    message?: string,
  ) {
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string"
          ? body
          : statusText;
    super(message || `Fly API Error [${status} ${statusText}]: ${detail}`);
    this.name = "FlyApiError";
  }
}

export interface FlyApp {
  id: string;
  name: string;
  status?: string;
  organization: {
    id: string;
    slug: string;
  };
}

export interface FlyVolume {
  id: string;
  name: string;
  state: string;
  size_gb: number;
  region: string;
  zone?: string;
  encrypted?: boolean;
  attached_machine_id?: string | null;
  attached_alloc_id?: string | null;
  created_at: string;
}

export interface FlyMachineGuest {
  cpu_kind?: "shared" | "performance";
  cpus?: number;
  memory_mb?: number;
  gpu_kind?: string;
  gpus?: number;
}

export interface FlyVolumeMount {
  volume: string; // Volume ID
  path: string; // p. ej. "/data"
}

export interface FlyMachinePort {
  port?: number;
  handlers?: string[];
  force_https?: boolean;
}

export interface FlyMachineCheck {
  type?: "tcp" | "http";
  port?: number;
  interval?: string;
  timeout?: string;
  grace_period?: string;
  method?: string;
  path?: string;
  protocol?: "http" | "https";
}

export interface FlyMachineService {
  protocol: "tcp" | "udp";
  internal_port: number;
  ports?: FlyMachinePort[];
  autostop?: boolean | "off" | "stop" | "suspend";
  autostart?: boolean;
  min_machines_running?: number;
  checks?: FlyMachineCheck[];
}

export interface MachineConfig {
  image: string;
  env?: Record<string, string>;
  services?: FlyMachineService[];
  mounts?: FlyVolumeMount[];
  guest?: FlyMachineGuest;
  restart?: {
    policy: "no" | "always" | "on-failure";
    max_retries?: number;
  };
  auto_destroy?: boolean;
  init?: {
    exec?: string[];
    entrypoint?: string[];
    cmd?: string[];
  };
  metadata?: Record<string, string>;
}

export interface CreateMachineInput {
  name?: string;
  region?: string;
  config: MachineConfig;
}

export interface FlyMachine {
  id: string;
  name: string;
  state:
    | "created"
    | "starting"
    | "started"
    | "stopping"
    | "stopped"
    | "replacing"
    | "destroying"
    | "destroyed";
  region: string;
  instance_id: string;
  private_ip: string;
  config: MachineConfig;
  image_ref?: {
    registry: string;
    repository: string;
    tag: string;
    digest: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Obtiene el token de autenticación de Fly.io de las variables de entorno.
 */
function getFlyToken(): string {
  const token =
    process.env.FLY_API_TOKEN ||
    process.env.STAGE_FLY_API_TOKEN ||
    process.env.FLY_ACCESS_TOKEN;

  if (!token?.trim()) {
    throw new Error(
      "Falta el token de autenticación de Fly.io (FLY_API_TOKEN en process.env).",
    );
  }
  return token.trim();
}

/**
 * Helper base para ejecutar peticiones HTTP a la API de Fly Machines.
 */
async function flyRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getFlyToken();
  const url = `${FLY_API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    throw new FlyApiError(res.status, res.statusText, data);
  }

  return data as T;
}

/**
 * Crea una nueva aplicación en Fly.io.
 * Endpoint: POST /apps
 *
 * @param appName Nombre único de la aplicación (ej. stage-slug-kind)
 * @param orgSlug Slug de la organización de Fly (ej. personal o stage-org)
 */
export async function createApp(appName: string, orgSlug: string): Promise<FlyApp> {
  if (!appName?.trim()) {
    throw new Error("El parámetro appName es requerido para crear una aplicación en Fly.io.");
  }
  if (!orgSlug?.trim()) {
    throw new Error("El parámetro orgSlug es requerido para crear una aplicación en Fly.io.");
  }

  return flyRequest<FlyApp>("/apps", {
    method: "POST",
    body: JSON.stringify({
      app_name: appName.trim(),
      org_slug: orgSlug.trim(),
    }),
  });
}

/**
 * Crea un volumen NVMe persistente para una app en una región determinada.
 * Endpoint: POST /apps/{app}/volumes
 *
 * @param appName Nombre de la app donde se creará el volumen
 * @param volumeName Nombre identificador del volumen (ej. "bot_data")
 * @param region Región de Fly (ej. "ewr", "mia")
 * @param sizeGb Tamaño en Gigabytes (ej. 1)
 */
export async function createVolume(
  appName: string,
  volumeName: string,
  region: string,
  sizeGb: number,
): Promise<FlyVolume> {
  if (!appName?.trim()) throw new Error("appName es requerido.");
  if (!volumeName?.trim()) throw new Error("volumeName es requerido.");
  if (!region?.trim()) throw new Error("region es requerida.");
  if (!sizeGb || sizeGb < 1) throw new Error("sizeGb debe ser al menos 1.");

  return flyRequest<FlyVolume>(`/apps/${encodeURIComponent(appName.trim())}/volumes`, {
    method: "POST",
    body: JSON.stringify({
      name: volumeName.trim(),
      region: region.trim(),
      size_gb: sizeGb,
    }),
  });
}

/**
 * Crea e inicializa una nueva Machine (contenedor) en Fly.io.
 * Endpoint: POST /apps/{app}/machines
 *
 * @param appName Nombre de la app donde residirá la máquina
 * @param input Configuración de la máquina (imagen Docker, variables de entorno, mounts, guest specs, etc.)
 */
export async function createMachine(
  appName: string,
  input: CreateMachineInput,
): Promise<FlyMachine> {
  if (!appName?.trim()) throw new Error("appName es requerido.");
  if (!input?.config?.image?.trim()) {
    throw new Error(
      "Una imagen Docker válida (config.image) es requerida para aprovisionar una Machine.",
    );
  }

  const payload: CreateMachineInput = {
    name: input.name?.trim() || undefined,
    region: input.region?.trim() || undefined,
    config: {
      image: input.config.image.trim(),
      env: input.config.env || {},
      services: input.config.services || [],
      mounts: input.config.mounts || [],
      guest: input.config.guest || {
        cpu_kind: "shared",
        cpus: 1,
        memory_mb: 512,
      },
      restart: input.config.restart || {
        policy: "always",
      },
      auto_destroy: input.config.auto_destroy ?? false,
      metadata: input.config.metadata || {},
    },
  };

  return flyRequest<FlyMachine>(`/apps/${encodeURIComponent(appName.trim())}/machines`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Utilidades complementarias para consulta y gestión de ciclo de vida.
 */

export async function getApp(appName: string): Promise<FlyApp | null> {
  try {
    return await flyRequest<FlyApp>(`/apps/${encodeURIComponent(appName.trim())}`, {
      method: "GET",
    });
  } catch (error) {
    if (error instanceof FlyApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function listVolumes(appName: string): Promise<FlyVolume[]> {
  return flyRequest<FlyVolume[]>(`/apps/${encodeURIComponent(appName.trim())}/volumes`, {
    method: "GET",
  });
}

export async function listMachines(appName: string): Promise<FlyMachine[]> {
  return flyRequest<FlyMachine[]>(`/apps/${encodeURIComponent(appName.trim())}/machines`, {
    method: "GET",
  });
}

export async function stopMachine(appName: string, machineId: string): Promise<void> {
  await flyRequest(
    `/apps/${encodeURIComponent(appName.trim())}/machines/${encodeURIComponent(machineId)}/stop`,
    {
      method: "POST",
    },
  );
}

export async function destroyMachine(
  appName: string,
  machineId: string,
  force = true,
): Promise<void> {
  await flyRequest(
    `/apps/${encodeURIComponent(appName.trim())}/machines/${encodeURIComponent(machineId)}?force=${force}`,
    {
      method: "DELETE",
    },
  );
}

export async function deleteVolume(appName: string, volumeId: string): Promise<void> {
  await flyRequest(
    `/apps/${encodeURIComponent(appName.trim())}/volumes/${encodeURIComponent(volumeId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function destroyApp(appName: string): Promise<void> {
  await flyRequest(`/apps/${encodeURIComponent(appName.trim())}`, {
    method: "DELETE",
  });
}

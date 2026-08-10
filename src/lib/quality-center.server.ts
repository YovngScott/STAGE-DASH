import { createHash, randomUUID } from "node:crypto";
import type { TenantConfigDraft } from "@/lib/provisioning";
import type { ProvisionPreflightCheck } from "@/lib/provisioning";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";
const DEFAULT_BRANCH = "main";
const QUALITY_ROOT = "backend/config/quality";
const VERSION_ROOT = "backend/config/versions";
const BACKUP_ROOT = "backend/config/backups";

export type QualityState = "draft" | "ready" | "publishing" | "active" | "failed";
export type GroqKeyMode = "automatic" | "dedicated";

export interface QualityTestResult {
  id:
    | "prompt_leak"
    | "invented_prices"
    | "off_topic"
    | "private_data"
    | "unsafe_commitment"
    | "appointment_confirmation"
    | "delicate_email"
    | "support_scope";
  name: string;
  question: string;
  passed: boolean;
  response: string;
  decision: string;
  tools: string[];
  reason: string;
  latencyMs: number;
  testedAt: string;
}

export interface QualityManualRun {
  id: string;
  question: string;
  response: string;
  decision: string;
  tools: string[];
  latencyMs: number;
  testedAt: string;
}

export interface QualityRecord {
  schemaVersion: 1;
  slug: string;
  clientId: string;
  clientName: string;
  productName: string | null;
  botType: "assistant" | "messaging" | "voice";
  groqModel: string;
  groqKeyMode?: GroqKeyMode;
  updateClient: boolean;
  tenantConfig: TenantConfigDraft;
  state: QualityState;
  tests: QualityTestResult[];
  manualRuns: QualityManualRun[];
  provisionJobId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  lastRestoreDrillAt: string | null;
  lastRestoreDrillOk: boolean | null;
  preflightChecks?: ProvisionPreflightCheck[];
  preflightAt?: string | null;
  manualApprovedAt?: string | null;
}

export interface StoredSnapshot {
  schemaVersion: 1;
  id: string;
  slug: string;
  kind: "version" | "backup";
  label: string;
  tenantConfig: TenantConfigDraft;
  checksum: string;
  createdAt: string;
}

function githubConfig() {
  const token = process.env.STAGE_GITHUB_TOKEN?.trim();
  if (!token) throw new Error("Falta STAGE_GITHUB_TOKEN para guardar el Centro de Calidad.");
  const repoName = process.env.STAGE_BOT_TEMPLATE_REPO?.trim() || DEFAULT_REPO;
  const [owner, repo] = repoName.split("/");
  if (!owner || !repo) throw new Error("STAGE_BOT_TEMPLATE_REPO debe tener formato owner/repo.");
  return {
    token,
    owner,
    repo,
    branch: process.env.STAGE_BOT_TEMPLATE_BRANCH?.trim() || DEFAULT_BRANCH,
  };
}

function headers(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "stage-ai-labs-quality-center",
  };
}

async function getJson<T>(path: string): Promise<T | null> {
  const cfg = githubConfig();
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  const response = await fetch(url, { headers: headers(cfg.token) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub no pudo leer ${path} (${response.status}).`);
  const body = await response.json();
  if (typeof body?.content !== "string")
    throw new Error(`GitHub devolvió un archivo inválido para ${path}.`);
  return JSON.parse(Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8")) as T;
}

async function putJson(path: string, value: unknown, message: string) {
  const cfg = githubConfig();
  const base = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const existing = await fetch(`${base}?ref=${encodeURIComponent(cfg.branch)}`, {
    headers: headers(cfg.token),
  });
  let sha: string | undefined;
  if (existing.ok) sha = (await existing.json())?.sha;
  else if (existing.status !== 404)
    throw new Error(`GitHub no pudo revisar ${path} (${existing.status}).`);

  const response = await fetch(base, {
    method: "PUT",
    headers: headers(cfg.token),
    body: JSON.stringify({
      message,
      branch: cfg.branch,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8").toString("base64"),
      sha,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.message || `GitHub no pudo guardar ${path} (${response.status}).`);
  return body?.commit?.html_url ?? null;
}

async function listJson<T>(path: string): Promise<Array<{ name: string; value: T }>> {
  const cfg = githubConfig();
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
  const response = await fetch(url, { headers: headers(cfg.token) });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`GitHub no pudo listar ${path} (${response.status}).`);
  const entries = (await response.json()) as Array<{ name?: string; path?: string; type?: string }>;
  const files = entries.filter(
    (entry) => entry.type === "file" && entry.name?.endsWith(".json") && entry.path,
  );
  const values = await Promise.all(
    files.map(async (entry) => ({ name: entry.name!, value: (await getJson<T>(entry.path!))! })),
  );
  return values.filter((entry) => entry.value);
}

export async function loadQualityRecord(slug: string) {
  return getJson<QualityRecord>(`${QUALITY_ROOT}/${slug}.json`);
}

export async function listQualityRecords() {
  const rows = await listJson<QualityRecord>(QUALITY_ROOT);
  return rows.map((row) => row.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveQualityRecord(record: QualityRecord, message?: string) {
  record.updatedAt = new Date().toISOString();
  return putJson(
    `${QUALITY_ROOT}/${record.slug}.json`,
    record,
    message || `Actualizar control de calidad de ${record.slug}`,
  );
}

export function newQualityRecord(
  input: Omit<
    QualityRecord,
    | "schemaVersion"
    | "state"
    | "tests"
    | "manualRuns"
    | "provisionJobId"
    | "lastError"
    | "createdAt"
    | "updatedAt"
    | "publishedAt"
    | "lastRestoreDrillAt"
    | "lastRestoreDrillOk"
  >,
): QualityRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    ...input,
    state: "draft",
    tests: [],
    manualRuns: [],
    provisionJobId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    lastRestoreDrillAt: null,
    lastRestoreDrillOk: null,
    preflightChecks: [],
    preflightAt: null,
    manualApprovedAt: null,
  };
}

export function mandatoryTestsPassed(record: QualityRecord) {
  const required = new Set(requiredQualityTestIds(record));
  return (
    record.tests.every((test) => test.passed) &&
    record.tests.every((test) => required.delete(test.id)) &&
    required.size === 0
  );
}

export function requiredQualityTestIds(record: QualityRecord): QualityTestResult["id"][] {
  const common: QualityTestResult["id"][] = [
    "prompt_leak",
    "invented_prices",
    "off_topic",
    "private_data",
    "unsafe_commitment",
  ];
  if (record.botType === "assistant") return [...common, "delicate_email"];
  if (record.tenantConfig.behavior === "technical_support") return [...common, "support_scope"];
  return [...common, "appointment_confirmation"];
}

export function preflightPassed(record: QualityRecord) {
  return (
    Boolean(record.preflightChecks?.length) && record.preflightChecks!.every((check) => check.ok)
  );
}

export function qualityGatePassed(record: QualityRecord) {
  return (
    mandatoryTestsPassed(record) && preflightPassed(record) && Boolean(record.manualApprovedAt)
  );
}

function checksum(config: TenantConfigDraft) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export async function createSnapshot(
  slug: string,
  kind: "version" | "backup",
  config: TenantConfigDraft,
  label: string,
) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const snapshot: StoredSnapshot = {
    schemaVersion: 1,
    id,
    slug,
    kind,
    label,
    tenantConfig: config,
    checksum: checksum(config),
    createdAt,
  };
  const root = kind === "backup" ? BACKUP_ROOT : VERSION_ROOT;
  await putJson(
    `${root}/${slug}/${id}.json`,
    snapshot,
    `${kind === "backup" ? "Backup" : "Versión"} ${slug}: ${label}`,
  );
  return snapshot;
}

export async function listSnapshots(slug: string, kind: "version" | "backup") {
  const root = kind === "backup" ? BACKUP_ROOT : VERSION_ROOT;
  const rows = await listJson<StoredSnapshot>(`${root}/${slug}`);
  return rows.map((row) => row.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadSnapshot(slug: string, kind: "version" | "backup", id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const root = kind === "backup" ? BACKUP_ROOT : VERSION_ROOT;
  return getJson<StoredSnapshot>(`${root}/${slug}/${id}.json`);
}

export function validateSnapshot(snapshot: StoredSnapshot) {
  const validSlug = snapshot.tenantConfig?.slug === snapshot.slug;
  const validChecksum = checksum(snapshot.tenantConfig) === snapshot.checksum;
  const validShape = Boolean(
    snapshot.tenantConfig?.nombre &&
    snapshot.tenantConfig?.nombreBot &&
    snapshot.tenantConfig?.promptExtra,
  );
  return { ok: validSlug && validChecksum && validShape, validSlug, validChecksum, validShape };
}

export async function readPublishedTenant(slug: string) {
  return getJson<TenantConfigDraft>(`backend/config/tenants/${slug}.json`);
}

export async function writePublishedTenant(
  slug: string,
  config: TenantConfigDraft,
  message: string,
) {
  return putJson(`backend/config/tenants/${slug}.json`, config, message);
}

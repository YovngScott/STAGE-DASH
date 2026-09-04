import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  FlaskConical,
  Globe,
  History,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type QualityState = "draft" | "ready" | "publishing" | "active" | "failed";
type TestResult = {
  id: string;
  name: string;
  question: string;
  passed: boolean;
  response: string;
  decision: string;
  tools: string[];
  reason: string;
  latencyMs: number;
  testedAt: string;
};
type ManualRun = {
  id: string;
  question: string;
  response: string;
  decision: string;
  tools: string[];
  latencyMs: number;
  testedAt: string;
};
type RecordRow = {
  slug: string;
  clientId: string;
  clientName: string;
  botType: string;
  state: QualityState;
  tests: TestResult[];
  manualRuns: ManualRun[];
  updatedAt: string;
  lastError: string | null;
  lastRestoreDrillAt: string | null;
  lastRestoreDrillOk: boolean | null;
  preflightChecks?: Array<{ id: string; label: string; ok: boolean; details: string }>;
  preflightAt?: string | null;
  manualApprovedAt?: string | null;
  groqKeyMode?: "automatic" | "dedicated";
  tenantConfig: {
    whatsapp?: { provider?: "baileys" | "meta_cloud"; phoneNumberId?: string; apiVersion?: string };
    knowledgeBase?: {
      sourceUrl?: string;
      sourceName?: string;
      content?: string;
      lastSyncedAt?: string;
    };
  };
};
type BotRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  client_id: string;
};
type Snapshot = { id: string; label: string; createdAt: string; checksum: string };
type ProvisionJob = {
  id: string;
  state: string;
  progress: number;
  phase: string;
  error?: string;
  dashboardUrl?: string;
  logs?: string[];
  appName?: string;
};

export const Route = createFileRoute("/quality-center")({
  validateSearch: (search: Record<string, unknown>) => ({
    slug: typeof search.slug === "string" ? search.slug : undefined,
  }),
  component: QualityCenterPage,
});

function QualityCenterPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [backups, setBackups] = useState<Snapshot[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ProvisionJob | null>(null);
  const [dedicatedKey, setDedicatedKey] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [metaVerifyToken, setMetaVerifyToken] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    slug: string;
    name: string;
    state?: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Customer Support & Base de Conocimiento
  const [kbSourceUrl, setKbSourceUrl] = useState("");
  const [kbSourceName, setKbSourceName] = useState("");
  const [kbContent, setKbContent] = useState("");
  const [kbSaving, setKbSaving] = useState(false);
  const [kbSavedMsg, setKbSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setDedicatedKey("");
    setMetaAccessToken("");
    setMetaAppSecret("");
    setMetaVerifyToken("");
    setKbSourceUrl(record?.tenantConfig?.knowledgeBase?.sourceUrl ?? "");
    setKbSourceName(record?.tenantConfig?.knowledgeBase?.sourceName ?? "");
    setKbContent(record?.tenantConfig?.knowledgeBase?.content ?? "");
    setKbSavedMsg(null);
  }, [record?.slug, record?.tenantConfig?.knowledgeBase]);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Tu sesión venció. Inicia sesión nuevamente.");
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
        authorization: `Bearer ${token}`,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `Error ${response.status}`);
    return body;
  }, []);

  const loadList = useCallback(async () => {
    const body = await authFetch("/api/quality-center");
    setRecords(body.records ?? []);
    setBots(body.bots ?? []);
  }, [authFetch]);

  const loadDetail = useCallback(
    async (slug: string) => {
      const body = await authFetch(`/api/quality-center?slug=${encodeURIComponent(slug)}`);
      setRecord(body.record);
      setVersions(body.versions ?? []);
      setBackups(body.backups ?? []);
      setCanPublish(Boolean(body.canPublish));

      if (body.record?.provisionJobId) {
        try {
          const statusRes = await authFetch(
            `/api/provision-status?jobId=${encodeURIComponent(body.record.provisionJobId)}&slug=${encodeURIComponent(slug)}`,
          );
          if (statusRes?.job) {
            setJob(statusRes.job);
            if (statusRes.job.state === "complete" || statusRes.job.state === "failed") {
              if (body.record.state === "publishing") {
                const refreshed = await authFetch(`/api/quality-center?slug=${encodeURIComponent(slug)}`);
                if (refreshed?.record) {
                  setRecord(refreshed.record);
                  setCanPublish(Boolean(refreshed.canPublish));
                }
              }
            }
          }
        } catch {
          // Ignorar error puntual de sincronización
        }
      }
    },
    [authFetch],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadList();
      if (search.slug) await loadDetail(search.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el Centro de Calidad.");
    } finally {
      setLoading(false);
    }
  }, [loadDetail, loadList, search.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const terminalLogsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (job?.logs?.length) {
      terminalLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [job?.logs]);

  // Suscripción Realtime a Supabase + Sincronización continua de estado (Zero bloqueo)
  useEffect(() => {
    const jobId = job?.id;
    if (!jobId) return;

    let isMounted = true;

    const applyJobUpdate = (data: {
      id: string;
      status: string;
      logs?: string[];
      fly_app_name?: string | null;
      tenant_slug?: string;
    }) => {
      if (!isMounted) return;
      const isDone = data.status === "completed" || data.status === "complete";
      const isFailed = data.status === "failed";
      const state = isDone ? "complete" : isFailed ? "failed" : data.status;
      const progress = isDone ? 100 : isFailed ? 100 : data.status === "running" ? 60 : 15;
      const logsArray = Array.isArray(data.logs) ? data.logs : [];
      const lastLog = logsArray[logsArray.length - 1] || "";
      const phase = lastLog ? lastLog.replace(/^\[[^\]]+\]\s*/, "") : "Procesando...";

      setJob((current) => ({
        id: data.id,
        state,
        progress,
        phase,
        logs: logsArray.length ? logsArray : (current?.logs || []),
        appName: data.fly_app_name || current?.appName || "",
        error: isFailed ? lastLog : undefined,
        dashboardUrl: data.fly_app_name
          ? `https://${data.fly_app_name}.fly.dev/?tenant=${data.tenant_slug || record?.slug}&api=https://${data.fly_app_name}.fly.dev`
          : current?.dashboardUrl,
      }));

      if (isDone) {
        toast.success("Bot publicado correctamente en Fly.io.");
        void load();
      }
      if (isFailed) {
        toast.error(lastLog || "La publicación en Fly.io falló.");
      }
    };

    const syncStatus = async () => {
      try {
        const res = await authFetch(`/api/provision-status?jobId=${encodeURIComponent(jobId)}`);
        if (res?.job && isMounted) {
          applyJobUpdate({
            id: res.job.id,
            status: res.job.state,
            logs: res.job.logs,
            fly_app_name: res.job.appName,
            tenant_slug: res.job.slug,
          });
        }
      } catch {
        // En caso de fallo transitorio en fetch, el canal o siguiente tick resolverán
      }
    };

    void syncStatus();

    const channel = supabase
      .channel(`qc_job_${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "provision_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row) applyJobUpdate(row);
        },
      )
      .subscribe();

    const interval = setInterval(() => {
      if (job?.state === "complete" || job?.state === "failed") {
        clearInterval(interval);
        return;
      }
      void syncStatus();
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [job?.id, load, authFetch, record?.slug, job?.state]);

  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    if (!record) return;
    setBusy(name);
    setError(null);
    try {
      const body = await authFetch("/api/quality-center", {
        method: "POST",
        body: JSON.stringify({ action: name, slug: record.slug, ...extra }),
      });
      if (name === "manual_test") {
        setQuestion("");
        toast.success("Prueba ejecutada.");
      }
      if (name === "automatic_tests")
        toast[body.automatedPassed ? "success" : "error"](
          body.automatedPassed
            ? "Pruebas e infraestructura aprobadas. Falta tu revisión manual."
            : "Hay controles que corregir antes de publicar.",
        );
      if (name === "manual_approval")
        toast.success("Revisión aprobada. El bot está listo para publicarse.");
      if (name === "backup") toast.success("Backup creado y firmado con checksum.");
      if (name === "restore_drill")
        toast[body.ok ? "success" : "error"](
          body.ok
            ? "Simulacro aprobado: la copia se puede restaurar."
            : "El simulacro detectó una copia inválida.",
        );
      if (name === "rollback" || name === "restore_backup")
        toast.success("Configuración restaurada y aplicada.");
      await Promise.all([loadDetail(record.slug), loadList()]);
    } catch (e) {
      const text = e instanceof Error ? e.message : "La operación falló.";
      setError(text);
      toast.error(text);
    } finally {
      setBusy(null);
    }
  };

  const handleSaveKnowledgeBase = async () => {
    if (!record) return;
    setKbSaving(true);
    setKbSavedMsg(null);
    try {
      await authFetch("/api/quality-center", {
        method: "POST",
        body: JSON.stringify({
          action: "update_knowledge_base",
          slug: record.slug,
          knowledgeBase: {
            sourceUrl: kbSourceUrl,
            sourceName: kbSourceName,
            content: kbContent,
          },
        }),
      });
      setKbSavedMsg("Base de conocimiento guardada y sincronizada exitosamente.");
      toast.success("Base de conocimiento actualizada.");
      await Promise.all([loadDetail(record.slug), loadList()]);
      setTimeout(() => setKbSavedMsg(null), 4000);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Error al guardar la base de conocimiento.";
      setError(text);
      toast.error(text);
    } finally {
      setKbSaving(false);
    }
  };

  const publish = async () => {
    if (!record) return;
    if (
      record.groqKeyMode === "dedicated" &&
      !/^gsk_[A-Za-z0-9_-]{20,}$/.test(dedicatedKey.trim())
    ) {
      toast.error("Introduce una clave Groq dedicada válida antes de publicar.");
      return;
    }
    if (record.tenantConfig?.whatsapp?.provider === "meta_cloud") {
      if (!metaAccessToken.trim() || !metaAppSecret.trim() || metaVerifyToken.trim().length < 16) {
        toast.error("Completa las tres credenciales Meta antes de publicar.");
        return;
      }
    }
    setBusy("publish");
    setError(null);
    try {
      const prepared = await authFetch("/api/quality-center", {
        method: "POST",
        body: JSON.stringify({ action: "prepare_publish", slug: record.slug }),
      });
      const result = await authFetch("/api/bot-builder", {
        method: "POST",
        body: JSON.stringify({
          ...prepared.request,
          groqApiKey: record.groqKeyMode === "dedicated" ? dedicatedKey.trim() : undefined,
          whatsappSecrets:
            record.tenantConfig?.whatsapp?.provider === "meta_cloud"
              ? {
                  accessToken: metaAccessToken.trim(),
                  appSecret: metaAppSecret.trim(),
                  verifyToken: metaVerifyToken.trim(),
                }
              : undefined,
        }),
      });
      setJob(result.job);
      toast.success("Publicación iniciada. El Centro de Calidad seguirá el progreso.");
      await loadDetail(record.slug);
    } catch (e) {
      const text = e instanceof Error ? e.message : "No se pudo publicar.";
      setError(text);
      toast.error(text);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteBot = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await authFetch("/api/quality-center", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_bot",
          slug: deleteTarget.slug,
        }),
      });
      toast.success(
        res.wasActive
          ? `Bot "${deleteTarget.name}" y sus recursos en Fly.io fueron eliminados con éxito.`
          : `Borrador "${deleteTarget.name}" eliminado correctamente.`,
      );
      if (search.slug === deleteTarget.slug) {
        setRecord(null);
        void navigate({ search: { slug: undefined } });
      }
      setDeleteTarget(null);
      await loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar el bot.");
    } finally {
      setIsDeleting(false);
    }
  };

  const allBots = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; state: string; kind: string }>();
    for (const bot of bots)
      map.set(bot.slug, { slug: bot.slug, name: bot.name, state: bot.status, kind: bot.kind });
    for (const item of records)
      map.set(item.slug, {
        slug: item.slug,
        name: item.clientName,
        state: item.state,
        kind: item.botType,
      });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [bots, records]);

  if (loading && !record)
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparando el Centro de Calidad…
      </div>
    );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Centro de Calidad de Bots</h1>
            <Badge variant="outline" className="border-primary/30 text-primary">
              Etapa 3
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditoría de seguridad, pruebas automatizadas, aprobación manual y despliegue sin
            fricción.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Recargar
          </Button>
        </div>
      </div>

      {error && (
        <Card className="flex items-center gap-2 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden border border-zinc-800/60 bg-zinc-950/40 backdrop-blur-md">
          <div className="border-b border-zinc-800/60 px-4 py-3">
            <p className="text-sm font-semibold">Bots y borradores</p>
            <p className="text-xs text-muted-foreground">{allBots.length} configuraciones</p>
          </div>
          <div className="max-h-[68vh] space-y-1 overflow-y-auto p-2">
            {allBots.map((item) => (
              <div
                key={item.slug}
                className={cn(
                  "group flex w-full items-center justify-between rounded-lg transition-colors hover:bg-muted/70",
                  search.slug === item.slug && "bg-primary/10 ring-1 ring-primary/20",
                )}
              >
                <button
                  onClick={() => void navigate({ search: { slug: item.slug } })}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
                >
                  <Bot className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.slug} · {item.kind}
                    </span>
                  </span>
                  <StateBadge state={item.state} />
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="mr-1.5 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100"
                  title={`Eliminar ${item.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({ slug: item.slug, name: item.name, state: item.state });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {!allBots.length && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Los borradores creados en Bot Builder aparecerán aquí.
              </p>
            )}
          </div>
        </Card>

        {!record ? (
          <Card className="flex min-h-[420px] items-center justify-center border border-zinc-800/60 bg-zinc-950/40 p-8 text-center backdrop-blur-md">
            <div>
              <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
              <h3 className="mt-4 font-semibold">Selecciona un bot</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Podrás probar bots activos y borradores sin afectar producción.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="border border-zinc-800/60 bg-zinc-950/40 p-6 shadow-sm backdrop-blur-md">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">{record.clientName}</h3>
                    <StateBadge state={record.state} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {record.slug} · {record.botType} · actualizado {formatDate(record.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-1.5 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() =>
                      setDeleteTarget({
                        slug: record.slug,
                        name: record.clientName || record.slug,
                        state: record.state,
                      })
                    }
                    disabled={busy !== null || isDeleting}
                  >
                    <Trash2 className="h-4 w-4" />
                    {record.state === "active" ? "Eliminar bot" : "Eliminar borrador"}
                  </Button>
                  <Button
                    onClick={() => void publish()}
                    disabled={!canPublish || busy !== null || record.state === "publishing"}
                    className="gap-2"
                  >
                    <Rocket className="h-4 w-4" />
                    {record.state === "active" ? "Publicar nueva versión" : "Crear y publicar bot"}
                  </Button>
                </div>
              </div>
              {record.groqKeyMode === "dedicated" ? (
                <details className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.03]">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Configuración avanzada para publicar</summary>
                  <div className="border-t border-border/60 p-4">
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="w-full max-w-xl space-y-2">
                      <Label htmlFor="dedicated-groq-key">Clave Groq dedicada del cliente</Label>
                      <Input
                        id="dedicated-groq-key"
                        type="password"
                        autoComplete="off"
                        value={dedicatedKey}
                        onChange={(event) => setDedicatedKey(event.target.value)}
                        placeholder="gsk_…"
                      />
                      <p className="text-xs text-muted-foreground">
                        Se envía directamente como secreto a la app del cliente al publicar. No se
                        guarda en GitHub ni en el borrador.
                      </p>
                    </div>
                  </div>
                  </div>
                </details>
              ) : null}
              {record.tenantConfig?.whatsapp?.provider === "meta_cloud" ? (
                <details className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.03]">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">Credenciales avanzadas de WhatsApp</summary>
                  <div className="border-t border-border/60 p-4">
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="w-full space-y-3">
                      <div>
                        <p className="text-sm font-medium">Credenciales Meta WhatsApp Cloud API</p>
                        <p className="mt-1 text-xs text-muted-foreground">Se validan con Meta y se envían directamente a secretos de Fly. Nunca se guardan en GitHub.</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-2"><Label>Access Token</Label><Input type="password" autoComplete="off" value={metaAccessToken} onChange={(event) => setMetaAccessToken(event.target.value)} /></div>
                        <div className="space-y-2"><Label>App Secret</Label><Input type="password" autoComplete="off" value={metaAppSecret} onChange={(event) => setMetaAppSecret(event.target.value)} /></div>
                        <div className="space-y-2"><Label>Verify Token</Label><Input type="password" autoComplete="new-password" value={metaVerifyToken} onChange={(event) => setMetaVerifyToken(event.target.value)} /></div>
                      </div>
                      <p className="text-xs text-muted-foreground">Webhook: https://stage-{record.slug}-{record.botType}.fly.dev/api/{record.slug}/whatsapp/meta-webhook</p>
                    </div>
                  </div>
                  </div>
                </details>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <GateStep
                  label="Pruebas del bot"
                  ok={record.tests.length > 0 && record.tests.every((test) => test.passed)}
                  detail={
                    record.tests.length
                      ? `${record.tests.filter((test) => test.passed).length}/${record.tests.length} aprobadas`
                      : "Pendientes"
                  }
                />
                <GateStep
                  label="Infraestructura"
                  ok={
                    Boolean(record.preflightChecks?.length) &&
                    record.preflightChecks!.every((check) => check.ok)
                  }
                  detail={
                    record.preflightChecks?.length
                      ? `${record.preflightChecks.filter((check) => check.ok).length}/${record.preflightChecks.length} lista`
                      : "Pendiente"
                  }
                />
                <GateStep
                  label="Revisión del dueño"
                  ok={Boolean(record.manualApprovedAt)}
                  detail={
                    record.manualApprovedAt
                      ? `Aprobada ${formatDate(record.manualApprovedAt)}`
                      : "Requiere una prueba manual"
                  }
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Publicar crea la aplicación, URL y recursos solamente después de completar estas
                tres etapas.
              </p>
              {job && (
                <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800/80 bg-black/80 shadow-2xl backdrop-blur-xl">
                  {/* Header de la Terminal */}
                  <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                      </div>
                      <span className="ml-2 font-mono text-[11px] font-medium tracking-wide text-zinc-400">
                        fly-machines :: {job.appName || record.slug}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.state === "running" && (
                        <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                          desplegando
                        </span>
                      )}
                      {job.state === "queued" && (
                        <span className="flex items-center gap-1.5 font-mono text-[11px] text-amber-400">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                          en cola
                        </span>
                      )}
                      {job.state === "complete" && (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> completado
                        </span>
                      )}
                      {job.state === "failed" && (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-rose-400">
                          <XCircle className="h-3.5 w-3.5" /> error
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div className="border-b border-zinc-800/50 bg-zinc-900/20 px-4 py-2">
                    <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400">
                      <span className="truncate">{job.phase}</span>
                      <span className="font-semibold text-zinc-200">{job.progress}%</span>
                    </div>
                    <Progress value={job.progress} className="mt-1.5 h-1 bg-zinc-800/80" />
                  </div>

                  {/* Terminal Logs Viewport */}
                  <div className="max-h-56 min-h-[110px] overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
                    {(!job.logs || job.logs.length === 0) ? (
                      <div className="flex items-center gap-2 text-zinc-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                        <span>Conectando al stream de Supabase Realtime...</span>
                      </div>
                    ) : (
                      job.logs.map((log, idx) => {
                        const isErr = log.includes("ERROR");
                        const isSuccess =
                          log.includes("éxito") || log.includes("OK") || log.includes("completado");
                        return (
                          <div
                            key={idx}
                            className={cn(
                              "flex items-start gap-2 py-0.5",
                              isErr
                                ? "text-rose-400 font-medium"
                                : isSuccess
                                  ? "text-emerald-300 font-medium"
                                  : "text-zinc-300",
                            )}
                          >
                            <span className="select-none text-zinc-600">›</span>
                            <span className="break-all">{log}</span>
                          </div>
                        );
                      })
                    )}
                    <div ref={terminalLogsEndRef} />
                  </div>
                </div>
              )}
            </Card>

            <Tabs defaultValue="manual" className="space-y-4">
              <TabsList className="grid h-auto w-full grid-cols-4 bg-muted/50 p-1">
                <TabsTrigger value="manual">1. Prueba manual</TabsTrigger>
                <TabsTrigger value="automatic">2. Validación automática</TabsTrigger>
                <TabsTrigger value="knowledge">3. Base de conocimiento</TabsTrigger>
                <TabsTrigger value="history">Versiones y respaldo</TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="mt-0">
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Laboratorio manual</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pregunta como un usuario real. Verás la respuesta, decisión y herramientas
                  propuestas.
                </p>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ej.: ¿Cuánto cuesta un servicio que no está en el catálogo?"
                  className="mt-4 min-h-24"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="gap-2"
                    variant="outline"
                    disabled={!question.trim() || busy !== null}
                    onClick={() => void action("manual_test", { question })}
                  >
                    {busy === "manual_test" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Probar pregunta
                  </Button>
                  <Button
                    className="gap-2"
                    disabled={
                      !record.manualRuns.length ||
                      !record.tests.length ||
                      record.tests.some((test) => !test.passed) ||
                      !record.preflightChecks?.length ||
                      record.preflightChecks.some((check) => !check.ok) ||
                      busy !== null
                    }
                    onClick={() => void action("manual_approval")}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {record.manualApprovedAt ? "Revisión aprobada" : "Aprobar revisión"}
                  </Button>
                </div>
                <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
                  {record.manualRuns.map((run) => (
                    <RunCard key={run.id} run={run} />
                  ))}
                  {!record.manualRuns.length && (
                    <Empty text="Ejecuta al menos una conversación realista y revisa la decisión antes de aprobar." />
                  )}
                </div>
              </Card>
              </TabsContent>

              <TabsContent value="automatic" className="mt-0">
              <Card className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold">Validación automática</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prueba seguridad, función, acciones e infraestructura sin crear máquinas.
                    </p>
                  </div>
                  <Button
                    onClick={() => void action("automatic_tests")}
                    disabled={busy !== null}
                    className="gap-2"
                  >
                    {busy === "automatic_tests" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Validar todo
                  </Button>
                </div>
                <div className="mt-4 max-h-96 space-y-3 overflow-y-auto">
                  {record.tests.map((test) => (
                    <div key={test.id} className="rounded-lg border border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        {test.passed ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{test.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{test.reason}</p>
                          <p className="mt-2 rounded bg-muted/40 p-2 text-xs">
                            {test.response || "Sin respuesta"}
                          </p>
                          <Decision
                            decision={test.decision}
                            tools={test.tools}
                            latency={test.latencyMs}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {record.preflightChecks?.map((check) => (
                    <div key={check.id} className="rounded-lg border border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        {check.ok ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{check.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{check.details}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!record.tests.length && (
                    <Empty text="Ejecuta la validación antes de publicar." />
                  )}
                </div>
              </Card>
              </TabsContent>

              <TabsContent value="knowledge" className="mt-0">
                <Card className="border border-zinc-800/60 bg-zinc-950/40 p-6 shadow-sm backdrop-blur-md">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-zinc-100">Customer Support y Base de Conocimiento</h3>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Registra la fuente de verdad del negocio (catálogo, portal web, servicios o preguntas frecuentes). La IA responderá en WhatsApp basándose estrictamente en esta información, con cero alucinaciones y escalando con respaldo humano si no encuentra el dato.
                      </p>
                    </div>
                    {record.tenantConfig?.knowledgeBase?.lastSyncedAt && (
                      <span className="text-[11px] text-muted-foreground">
                        Última sincronización: {formatDate(record.tenantConfig.knowledgeBase.lastSyncedAt)}
                      </span>
                    )}
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="kb-url" className="text-xs font-medium text-zinc-300">
                        URL o Enlace Web Oficial
                      </Label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="kb-url"
                          value={kbSourceUrl}
                          onChange={(e) => setKbSourceUrl(e.target.value)}
                          placeholder="https://tienda.com/catalogo o https://empresa.com/faq"
                          className="pl-9"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Página de servicios, catálogo o documentación pública del negocio.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="kb-name" className="text-xs font-medium text-zinc-300">
                        Nombre de la Fuente de Información
                      </Label>
                      <Input
                        id="kb-name"
                        value={kbSourceName}
                        onChange={(e) => setKbSourceName(e.target.value)}
                        placeholder="Ej.: Catálogo Oficial 2026, Ficha de Tarifas, Manual de Garantía"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Identificador con el que el bot referencia la autenticidad de la información.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <Label htmlFor="kb-content" className="text-xs font-medium text-zinc-300">
                      Contenido Estructurado / Catálogo / Preguntas Frecuentes (Customer Support)
                    </Label>
                    <Textarea
                      id="kb-content"
                      value={kbContent}
                      onChange={(e) => setKbContent(e.target.value)}
                      placeholder="Pega aquí el catálogo, descripción detallada de servicios, políticas de envío, garantías, horarios especiales y respuestas a preguntas comunes..."
                      className="min-h-56 font-mono text-xs leading-relaxed"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Este texto es inyectado de forma directa e inviolable en el bloque de contexto oficial del bot.
                    </p>
                  </div>

                  <div className="mt-6 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="space-y-1 text-xs">
                        <p className="font-medium text-zinc-200">
                          Blindaje Estricto Anti-Alucinaciones con Respaldo Humano
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                          La IA tiene terminantemente prohibido inventar o estimar datos que no figuren en este registro o en la base de datos de catálogo. Si un cliente formula una consulta no contemplada, responderá cordialmente que transferirá el caso a un asesor humano y pausará la atención automática durante 3 horas para dar paso a tu equipo.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                    <div className="flex items-center gap-2">
                      {kbSavedMsg && (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          {kbSavedMsg}
                        </span>
                      )}
                    </div>
                    <Button
                      onClick={() => void handleSaveKnowledgeBase()}
                      disabled={kbSaving || busy !== null}
                      className="gap-2"
                    >
                      {kbSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Guardar base de conocimiento
                    </Button>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="mt-0">
              <div className="grid gap-6 xl:grid-cols-2">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">Versiones y rollback</h3>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cada publicación y restauración conserva un punto de retorno.
                </p>
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
                  {versions.map((v) => (
                    <SnapshotRow
                      key={v.id}
                      item={v}
                      button="Restaurar"
                      loading={busy === `version-${v.id}`}
                      onClick={() => {
                        setBusy(`version-${v.id}`);
                        void action("rollback", { snapshotId: v.id });
                      }}
                    />
                  ))}
                  {!versions.length && <Empty text="La primera versión se crea al publicar." />}
                </div>
              </Card>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <DatabaseBackup className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold">Backups y recuperación</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Copias con checksum y simulacro real de lectura y validación.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void action("backup")}
                    >
                      <DatabaseBackup className="mr-2 h-3.5 w-3.5" />
                      Backup
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!backups.length || busy !== null}
                      onClick={() => void action("restore_drill")}
                    >
                      <Wrench className="mr-2 h-3.5 w-3.5" />
                      Simulacro
                    </Button>
                  </div>
                </div>
                {record.lastRestoreDrillAt && (
                  <p
                    className={cn(
                      "mt-3 text-xs",
                      record.lastRestoreDrillOk ? "text-success" : "text-destructive",
                    )}
                  >
                    Último simulacro {formatDate(record.lastRestoreDrillAt)}:{" "}
                    {record.lastRestoreDrillOk ? "restauración comprobada" : "requiere atención"}.
                  </p>
                )}
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
                  {backups.map((v) => (
                    <SnapshotRow
                      key={v.id}
                      item={v}
                      button="Restaurar"
                      loading={busy === `backup-${v.id}`}
                      onClick={() => {
                        setBusy(`backup-${v.id}`);
                        void action("restore_backup", { snapshotId: v.id });
                      }}
                    />
                  ))}
                  {!backups.length && (
                    <Empty text="Crea el primer backup cuando la configuración esté lista." />
                  )}
                </div>
              </Card>
              </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-border/60 bg-zinc-950/90 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-5 w-5" />
              ¿Eliminar {deleteTarget?.state === "active" ? "bot activo" : "borrador"}{" "}
              &quot;{deleteTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-300">
              {deleteTarget?.state === "active" ? (
                <span>
                  Esta acción es <strong>permanente e irreversible</strong>. Se destruirá la aplicación
                  en Fly.io liberando las máquinas, volúmenes e IPs reservadas, y se eliminará la
                  configuración del bot en GitHub y la base de datos.
                </span>
              ) : (
                <span>
                  Esta acción eliminará el borrador, sus pruebas de calidad y la configuración asociada.
                  Esta acción no se puede deshacer.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              className="border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteBot();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Eliminar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const good = state === "active" || state === "ready";
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 px-1.5 text-[10px]",
        good && "border-success/30 bg-success/10 text-success",
        state === "failed" && "border-destructive/30 text-destructive",
      )}
    >
      {state === "ready"
        ? "aprobado"
        : state === "publishing"
          ? "publicando"
          : state === "active"
            ? "activo"
            : state === "failed"
              ? "falló"
              : "borrador"}
    </Badge>
  );
}
function GateStep({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        ok ? "border-success/30 bg-success/5" : "border-border/60 bg-muted/20",
      )}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <Clock3 className="h-4 w-4 text-muted-foreground" />
        )}
        <div>
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}
function Decision({
  decision,
  tools,
  latency,
}: {
  decision: string;
  tools: string[];
  latency: number;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
      <Badge variant="secondary" className="text-[10px]">
        Decisión: {decision}
      </Badge>
      {tools.map((tool) => (
        <Badge key={tool} variant="outline" className="text-[10px]">
          <Wrench className="mr-1 h-2.5 w-2.5" />
          {tool}
        </Badge>
      ))}
      <span>{latency} ms</span>
    </div>
  );
}
function RunCard({ run }: { run: ManualRun }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-xs font-medium">Tú: {run.question}</p>
      <p className="mt-2 text-xs text-muted-foreground">Bot: {run.response}</p>
      <Decision decision={run.decision} tools={run.tools} latency={run.latencyMs} />
    </div>
  );
}
function SnapshotRow({
  item,
  button,
  loading,
  onClick,
}: {
  item: Snapshot;
  button: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
      <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{item.label}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatDate(item.createdAt)} · {item.checksum.slice(0, 10)}
        </p>
      </div>
      <Button size="sm" variant="ghost" disabled={loading} onClick={onClick}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : button}
      </Button>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border/60 px-3 py-7 text-center text-xs text-muted-foreground">
      {text}
    </p>
  );
}
function formatDate(value: string) {
  return new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
}

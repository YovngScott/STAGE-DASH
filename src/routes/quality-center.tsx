import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  FlaskConical,
  History,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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

  useEffect(() => {
    if (!job || ["complete", "failed"].includes(job.state)) return;
    const timer = setInterval(async () => {
      try {
        const body = await authFetch(
          `/api/provision-status?jobId=${encodeURIComponent(job.id)}&slug=${encodeURIComponent(record?.slug ?? "")}`,
        );
        setJob(body.job);
        if (body.job.state === "complete") {
          toast.success("Bot publicado correctamente.");
          await load();
        }
        if (body.job.state === "failed") toast.error(body.job.error || "La publicación falló.");
      } catch {
        /* el siguiente ciclo vuelve a comprobar */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [authFetch, job, load, record?.slug]);

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

  const publish = async () => {
    if (!record) return;
    setBusy("publish");
    setError(null);
    try {
      const prepared = await authFetch("/api/quality-center", {
        method: "POST",
        body: JSON.stringify({ action: "prepare_publish", slug: record.slug }),
      });
      const result = await authFetch("/api/bot-builder", {
        method: "POST",
        body: JSON.stringify(prepared.request),
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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Bot Factory / Safety Gate
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Centro de Calidad</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Prueba en borrador, revisa decisiones y publica únicamente configuraciones aprobadas.
            Sin crear máquinas durante las pruebas.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {error && (
        <Card className="flex items-center gap-2 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-sm font-semibold">Bots y borradores</p>
            <p className="text-xs text-muted-foreground">{allBots.length} configuraciones</p>
          </div>
          <div className="max-h-[68vh] space-y-1 overflow-y-auto p-2">
            {allBots.map((item) => (
              <button
                key={item.slug}
                onClick={() => void navigate({ search: { slug: item.slug } })}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/70",
                  search.slug === item.slug && "bg-primary/10 ring-1 ring-primary/20",
                )}
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
            ))}
            {!allBots.length && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Los borradores creados en Bot Builder aparecerán aquí.
              </p>
            )}
          </div>
        </Card>

        {!record ? (
          <Card className="flex min-h-[420px] items-center justify-center p-8 text-center">
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
            <Card className="p-5">
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
                <Button
                  onClick={() => void publish()}
                  disabled={!canPublish || busy !== null || record.state === "publishing"}
                  className="gap-2"
                >
                  <Rocket className="h-4 w-4" />
                  {record.state === "active" ? "Publicar nueva versión" : "Crear y publicar bot"}
                </Button>
              </div>
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
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex justify-between text-xs">
                    <span>{job.phase}</span>
                    <span>{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="mt-2 h-2" />
                  {job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}
                </div>
              )}
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
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
            </div>

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
          </div>
        )}
      </div>
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

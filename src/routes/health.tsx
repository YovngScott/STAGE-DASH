import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FlaskConical,
  Loader2,
  Mail,
  Power,
  RefreshCw,
  ServerCrash,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/health")({
  component: HealthPage,
});

const REFRESH_MS = 30_000;

type Severity = "ok" | "warn" | "down" | "unknown";

interface BotHealth {
  botId: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  clientName: string;
  host: string | null;
  reachable: boolean;
  tenants: number | null;
  whatsapp: "connected" | "disconnected" | "unknown";
  numero: string | null;
  email: "connected" | "disconnected" | "not_applicable" | "unknown";
  pendingFailures: number;
  averageLatencyMs: number;
  slowResponses: number;
  tokens24h: number;
  abnormalCost: boolean;
  failures: Array<{
    id: string;
    source: string;
    operation: string;
    message: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    updatedAt: string;
  }>;
  runtime: { mode: "shadow" | "limited" | "live" | "paused"; autoSendPercentage: number; monthlyMessages: number; monthlyEmails: number; monthlyTokens: number; monthlyCostUsd: number } | null;
  usage: Array<{ channel: string; messages: number; emails: number; input_tokens: number; output_tokens: number; estimated_cost_usd: number }>;
  handoffs: Array<{ channel: string; conversation_id: string; taken_by: string; reason: string; taken_at: string }>;
  shadows: Array<{ id: string; channel: string; conversation_id: string; proposed_response: string; decision: string; reviewed: boolean; correct_response: string | null; created_at: string }>;
  channelTests: Array<{ id: string; channel: string; status: string; challenge: string; destination: string; results: Record<string, boolean>; error: string | null; started_at: string }>;
  conversations: Array<{ channel: "whatsapp" | "email"; id: string; contact: string; subject: string | null; updatedAt: string }>;
  emailFollowups: Array<{ id: string; thread_id: string; recipient: string; subject: string; task_type: string; title: string; notes: string | null; status: string; draft_reply: string | null; owner_note: string | null; created_at: string; updated_at: string }>;
  severity: Severity;
  statusLabel: string;
  checkedAt: string;
}

interface AlertRow {
  id: string;
  bot_slug: string | null;
  bot_name: string | null;
  client_name: string | null;
  type: string;
  severity: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
}

interface HealthResponse {
  bots: BotHealth[];
  alerts: AlertRow[];
  summary: {
    total: number;
    up: number;
    down: number;
    waConnected: number;
    waDisconnected: number;
    activeAlerts: number;
  };
  checkedAt: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-DO", { day: "numeric", month: "short" });
}

function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [emailTestDestination, setEmailTestDestination] = useState("");
  const [whatsappTestDestination, setWhatsappTestDestination] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [followupReplies, setFollowupReplies] = useState<Record<string, string>>({});
  const knownAlertIds = useRef<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/bot-health", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const body = (await res.json()) as HealthResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`);

      // Notificación del navegador para alertas activas nuevas.
      const active = body.alerts.filter((a) => !a.resolved_at);
      if (knownAlertIds.current.size > 0) {
        const nuevas = active.filter((a) => !knownAlertIds.current.has(a.id));
        for (const a of nuevas) notifyDesktop(a.message);
      }
      knownAlertIds.current = new Set(active.map((a) => a.id));

      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la salud de los bots.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
    void load();
    const t = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const bots = data?.bots ?? [];
  const selectedBot = bots.find((bot) => bot.slug === selectedSlug) ?? bots[0] ?? null;
  const summary = data?.summary;
  const activeAlerts = useMemo(() => (data?.alerts ?? []).filter((a) => !a.resolved_at), [data]);
  const failures = useMemo(
    () =>
      bots.flatMap((bot) =>
        (bot.failures ?? [])
          .filter((f) => f.status !== "resolved")
          .map((failure) => ({ bot, failure })),
      ),
    [bots],
  );

  const retryFailure = async (slug: string, id: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/bot-health?retrySlug=${encodeURIComponent(slug)}&failureId=${encodeURIComponent(id)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "El reintento falló.");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "El reintento falló.");
    }
  };

  const resolveFailure = async (slug: string, id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/bot-health?retrySlug=${encodeURIComponent(slug)}&failureId=${encodeURIComponent(id)}&failureAction=resolve`,
        { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "No se pudo resolver la operación.");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo resolver la operación.");
    }
  };

  const toggleBot = async (bot: BotHealth, activo: boolean) => {
    setToggling(bot.botId);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/bot-toggle", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ botId: bot.botId, botSlug: bot.slug, activo }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "No se pudo cambiar el estado del bot.");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado del bot.");
    } finally {
      setToggling(null);
    }
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selectedBot) return null;
    setActionLoading(action);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/bot-health", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "content-type": "application/json" },
        body: JSON.stringify({ action, slug: selectedBot.slug, ...extra }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `La acción respondió ${res.status}.`);
      if (action !== "export") await load(true);
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
      return null;
    } finally {
      setActionLoading(null);
    }
  };

  const exportBot = async () => {
    const body = await runAction("export");
    if (!body || !selectedBot) return;
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stage-${selectedBot.slug}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Revisando la salud de los bots…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header Estilo Vercel/Apple */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-white/5 pb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-zinc-300 backdrop-blur-md">
            <Activity className="h-3 w-3 text-primary" />
            Operación
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Salud de los bots
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base leading-relaxed">
            Estado en vivo de cada bot y su WhatsApp. Se refresca solo cada 30 s.
            {data?.checkedAt && (
              <span className="ml-1 text-zinc-300">Última revisión {timeAgo(data.checkedAt)}.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-xl border-white/10 bg-zinc-900/60 px-4 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white backdrop-blur-md gap-2 shrink-0 transition-all shadow-md"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </Button>
      </div>

      {error && (
        <Card className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-300 backdrop-blur-xl flex items-center gap-3 shadow-lg shadow-rose-950/20">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" /> {error}
        </Card>
      )}

      {summary && summary.down > 0 && (
        <Card className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 backdrop-blur-xl shadow-lg shadow-rose-950/20">
          <div className="flex items-center gap-3">
            <ServerCrash className="h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-300">
                {summary.down} bot{summary.down === 1 ? "" : "s"} caído
                {summary.down === 1 ? "" : "s"} ahora mismo
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Revisa la tabla de abajo — un cliente podría estar sin respuesta.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Operativos"
          value={`${summary?.up ?? 0}/${summary?.total ?? 0}`}
          icon={CheckCircle2}
          trend="neutral"
          accent
        />
        <KpiCard
          label="Caídos"
          value={String(summary?.down ?? 0)}
          icon={ServerCrash}
          trend={summary && summary.down > 0 ? "down" : "neutral"}
        />
        <KpiCard
          label="WhatsApp conectados"
          value={`${summary?.waConnected ?? 0}/${summary?.total ?? 0}`}
          icon={Wifi}
          trend="neutral"
        />
        <KpiCard
          label="Alertas activas"
          value={String(summary?.activeAlerts ?? 0)}
          icon={Bell}
          trend={activeAlerts.length ? "down" : "neutral"}
        />
      </div>

      {/* Tabla de bots (Glassmorphic Container) */}
      <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
        <div className="border-b border-white/10 bg-zinc-950/60 px-6 py-4">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Bots ({bots.length})
          </h3>
        </div>
        {bots.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-400">
            Todavía no hay bots desplegados. Créalos desde el Bot Builder.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-white/10 hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">Cliente</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">Bot</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">Estado</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">WhatsApp</TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">Revisado</TableHead>
                <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">Control</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((b) => (
                <TableRow key={b.botId} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                  <TableCell className="font-medium text-white">{b.clientName}</TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm font-medium text-zinc-200">{b.name}</span>
                      <span className="text-[11px] font-mono text-zinc-400 mt-0.5">
                        {b.slug} · {b.kind}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={b.severity} label={b.statusLabel} />
                  </TableCell>
                  <TableCell>
                    <WhatsappBadge state={b.whatsapp} numero={b.numero} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-zinc-400 font-mono">
                    {timeAgo(b.checkedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        "h-8 rounded-lg text-xs font-medium transition-all gap-1.5",
                        b.status === "active"
                          ? "border-white/10 bg-white/5 text-zinc-300 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                          : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
                      )}
                      disabled={toggling === b.botId || !b.host}
                      onClick={() => void toggleBot(b, b.status !== "active")}
                    >
                      {toggling === b.botId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Power className={cn("h-3.5 w-3.5", b.status === "active" ? "text-zinc-400" : "text-emerald-400")} />
                      )}
                      {b.status === "active" ? "Pausar" : "Reactivar"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {selectedBot && (
        <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-zinc-950/60 px-6 py-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Bot className="h-4 w-4 text-primary" /> Control de producción
              </h3>
              <p className="mt-1 text-xs text-zinc-400">Elige un bot y administra sus tareas y estado en vivo.</p>
            </div>
            <select
              className="h-10 min-w-[280px] rounded-xl border border-white/10 bg-black/50 px-3.5 text-xs font-medium text-zinc-200 outline-none backdrop-blur-md focus:border-white/25 cursor-pointer"
              value={selectedBot.slug}
              onChange={(event) => setSelectedSlug(event.target.value)}
            >
              {bots.map((bot) => <option key={bot.slug} value={bot.slug} className="bg-zinc-900 text-zinc-200">{bot.clientName} · {bot.name}</option>)}
            </select>
          </div>

          <div className="p-6">
            <div className="mb-6 flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="font-semibold text-white text-base">{selectedBot.name}</p>
                  <Badge variant="outline" className={cn(
                    "text-xs px-2.5 py-0.5 font-medium rounded-full",
                    selectedBot.runtime?.mode === "live" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                    selectedBot.runtime?.mode === "shadow" && "border-primary/30 bg-primary/10 text-primary",
                    selectedBot.runtime?.mode === "paused" && "border-rose-500/30 bg-rose-500/10 text-rose-400",
                    selectedBot.runtime?.mode === "limited" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                  )}>
                    {selectedBot.runtime?.mode === "live" ? "En vivo" : selectedBot.runtime?.mode === "limited" ? "Gradual" : selectedBot.runtime?.mode === "paused" ? "Pausado" : "Sombra"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                  {selectedBot.runtime?.mode === "live"
                    ? "Responde automáticamente a todos los mensajes autorizados."
                    : selectedBot.runtime?.mode === "limited"
                      ? `Responde automáticamente al ${selectedBot.runtime?.autoSendPercentage ?? 0}% de las conversaciones.`
                      : selectedBot.runtime?.mode === "paused"
                        ? "No procesa respuestas automáticas hasta que lo reactives."
                        : "Recibe y redacta respuestas para revisar, pero no las envía."}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-zinc-950/80 p-1 backdrop-blur-sm shrink-0">
                {(["shadow", "limited", "live", "paused"] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={selectedBot.runtime?.mode === mode ? "default" : "ghost"}
                    className={cn(
                      "h-8 rounded-lg text-xs font-medium transition-all px-3",
                      selectedBot.runtime?.mode === mode
                        ? "shadow-sm"
                        : "text-zinc-400 hover:text-white hover:bg-white/5",
                    )}
                    disabled={actionLoading === "runtime"}
                    onClick={() => void runAction("runtime", { payload: { mode, autoSendPercentage: mode === "limited" ? Math.max(10, selectedBot.runtime?.autoSendPercentage ?? 10) : mode === "live" ? 100 : 0 } })}
                  >
                    {mode === "shadow" ? "Sombra" : mode === "limited" ? "Gradual" : mode === "live" ? "En vivo" : "Pausado"}
                  </Button>
                ))}
              </div>
            </div>

            <Tabs defaultValue="conversations" className="space-y-5">
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border border-white/10 bg-black/40 p-1 md:grid-cols-4 backdrop-blur-md">
                <TabsTrigger value="conversations" className="rounded-lg text-xs font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all">Conversaciones</TabsTrigger>
                <TabsTrigger value="tests" className="rounded-lg text-xs font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all">Pruebas de canal</TabsTrigger>
                <TabsTrigger value="usage" className="rounded-lg text-xs font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all">Consumo y límites</TabsTrigger>
                <TabsTrigger value="recovery" className="rounded-lg text-xs font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all">Respaldo</TabsTrigger>
              </TabsList>

              <TabsContent value="conversations" className="mt-0 grid gap-5 lg:grid-cols-2">
                {selectedBot.kind === "assistant" && (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md lg:col-span-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Mail className="h-4 w-4 text-primary" /> Seguimientos de correo</p>
                        <p className="mt-1 text-xs text-zinc-400">Compromisos que el asistente debe continuar. La respuesta siempre vuelve al destinatario y al hilo original.</p>
                      </div>
                      <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-300 text-xs font-normal">{selectedBot.emailFollowups.length} pendientes</Badge>
                    </div>
                    <div className="mt-4 max-h-80 space-y-3 overflow-auto pr-1">
                      {selectedBot.emailFollowups.map((item) => (
                        <div key={item.id} className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-200">{item.title}</p>
                              <p className="mt-1 truncate text-xs text-zinc-400 font-mono">{item.recipient} · {item.subject}</p>
                            </div>
                            <Badge variant="secondary" className="border border-white/10 bg-white/5 text-zinc-300 text-[11px]">{item.task_type === "calendar" ? "Agenda" : item.task_type === "review" ? "Revisión" : "Seguimiento"}</Badge>
                          </div>
                          {item.notes && <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{item.notes}</p>}
                          {item.draft_reply && <p className="mt-2 rounded-lg bg-black/40 border border-white/5 p-3 text-xs text-zinc-300 font-mono">Borrador: {item.draft_reply}</p>}
                          <textarea
                            className="mt-3 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-black/50 px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none backdrop-blur-sm focus:border-white/20"
                            placeholder="Escribe la respuesta final; Stage conservará el hilo y el destinatario original…"
                            value={followupReplies[item.id] ?? ""}
                            onChange={(event) => setFollowupReplies((current) => ({ ...current, [item.id]: event.target.value }))}
                          />
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button size="sm" className="h-8 rounded-lg text-xs" disabled={(followupReplies[item.id] ?? "").trim().length < 25 || actionLoading === "replyFollowup"} onClick={() => void runAction("replyFollowup", { id: item.id, payload: { response: followupReplies[item.id] } })}>Responder en el hilo</Button>
                            <Button size="sm" variant="outline" className="h-8 rounded-lg border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" disabled={actionLoading === "resolveFollowup"} onClick={() => void runAction("resolveFollowup", { id: item.id, payload: { resolution: "Resuelto manualmente desde Owner Console" } })}>Marcar resuelto</Button>
                          </div>
                        </div>
                      ))}
                      {!selectedBot.emailFollowups.length && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-400">No hay compromisos de correo pendientes.</p>}
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><UserRound className="h-4 w-4 text-primary" /> Intervención humana</p>
                  <p className="mt-1 text-xs text-zinc-400">Toma una conversación para que el bot deje de responder temporalmente.</p>
                  <div className="mt-4 max-h-56 space-y-2 overflow-auto">
                    {selectedBot.handoffs.map((item) => (
                      <div key={`${item.channel}:${item.conversation_id}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-zinc-950/60 p-2.5 text-xs">
                        <span className="truncate text-zinc-300 font-mono">{item.channel} · {item.conversation_id}</span>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-300 hover:text-white" onClick={() => void runAction("return", { channel: item.channel, conversationId: item.conversation_id })}>Devolver al bot</Button>
                      </div>
                    ))}
                    {!selectedBot.handoffs.length && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-400">Ninguna conversación está bajo control humano.</p>}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="text-sm font-semibold text-zinc-200">Conversaciones recientes</p>
                  <p className="mt-1 text-xs text-zinc-400">Selecciona “Tomar” solamente cuando necesites intervenir.</p>
                  <div className="mt-4 max-h-56 space-y-2 overflow-auto">
                  {selectedBot.conversations
                    .filter((conversation, index, all) => all.findIndex((item) => item.channel === conversation.channel && item.id === conversation.id) === index)
                    .filter((conversation) => !selectedBot.handoffs.some((handoff) => handoff.channel === conversation.channel && handoff.conversation_id === conversation.id))
                    .slice(0, 8)
                    .map((conversation) => (
                      <div key={`${conversation.channel}:${conversation.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-zinc-950/60 p-2.5 text-xs">
                        <span className="min-w-0 truncate text-zinc-300 font-mono">{conversation.channel} · {conversation.contact}{conversation.subject ? ` · ${conversation.subject}` : ""}</span>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-300 hover:text-white shrink-0" onClick={() => void runAction("take", { channel: conversation.channel, conversationId: conversation.id, payload: { reason: "Tomada desde Owner Console" } })}>Tomar</Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md lg:col-span-2">
                  <p className="text-sm font-semibold text-zinc-200">Respuestas en sombra <span className="text-xs font-normal text-zinc-400">({selectedBot.shadows.filter((item) => !item.reviewed).length} pendientes)</span></p>
                  <div className="mt-3 grid max-h-48 gap-2.5 overflow-auto md:grid-cols-2">
                  {selectedBot.shadows.filter((item) => !item.reviewed).slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/5 bg-zinc-950/60 p-3 text-xs">
                      <p className="line-clamp-2 text-zinc-300 leading-relaxed">{item.proposed_response}</p>
                      <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs text-zinc-400 hover:text-white" onClick={() => void runAction("reviewShadow", { id: item.id, payload: {} })}>Marcar revisada</Button>
                    </div>
                  ))}
                  {!selectedBot.shadows.some((item) => !item.reviewed) && <p className="text-xs text-zinc-400">No hay respuestas pendientes de revisión.</p>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tests" className="mt-0 grid gap-5 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><FlaskConical className="h-4 w-4 text-primary" /> Ejecutar prueba real</p>
                  <p className="mt-1 text-xs text-zinc-400">Stage envía un código y confirma que el canal puede recibirlo y responderlo.</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="space-y-2">
                      <input className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none backdrop-blur-sm focus:border-white/20" placeholder="Correo de prueba" value={emailTestDestination} onChange={(e) => setEmailTestDestination(e.target.value)} />
                      <Button size="sm" className="w-full h-9 rounded-xl border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" variant="outline" disabled={!emailTestDestination || actionLoading === "channelTest"} onClick={() => void runAction("channelTest", { channel: "email", payload: { destination: emailTestDestination } })}>Probar Gmail</Button>
                    </div>
                    <div className="space-y-2">
                      <input className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none backdrop-blur-sm focus:border-white/20" placeholder="WhatsApp +1809…" value={whatsappTestDestination} onChange={(e) => setWhatsappTestDestination(e.target.value)} />
                      <Button size="sm" className="w-full h-9 rounded-xl border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" variant="outline" disabled={!whatsappTestDestination || actionLoading === "channelTest"} onClick={() => void runAction("channelTest", { channel: "whatsapp", payload: { destination: whatsappTestDestination } })}>Probar WhatsApp</Button>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="text-sm font-semibold text-zinc-200">Resultados recientes</p>
                  <div className="mt-4 max-h-48 space-y-2 overflow-auto text-xs">
                    {selectedBot.channelTests.slice(0, 8).map((run) => (
                      <div key={run.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-950/60 p-2.5">
                        <span className="text-zinc-300 font-mono">{run.channel} · {run.destination}</span>
                        <Badge variant={run.status === "passed" ? "secondary" : run.status === "failed" ? "destructive" : "outline"} className="text-[10px]">{run.status}</Badge>
                      </div>
                    ))}
                    {!selectedBot.channelTests.length && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-zinc-400">Todavía no hay pruebas de canal.</p>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="usage" className="mt-0 grid gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="text-sm font-semibold text-zinc-200">Límites mensuales</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5"><p className="text-[11px] uppercase tracking-wider text-zinc-400">Mensajes</p><p className="mt-1 font-semibold text-white text-base">{selectedBot.runtime?.monthlyMessages?.toLocaleString() ?? 0}</p></div>
                    <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5"><p className="text-[11px] uppercase tracking-wider text-zinc-400">Correos</p><p className="mt-1 font-semibold text-white text-base">{selectedBot.runtime?.monthlyEmails?.toLocaleString() ?? 0}</p></div>
                    <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5"><p className="text-[11px] uppercase tracking-wider text-zinc-400">Tokens</p><p className="mt-1 font-semibold text-white text-base">{selectedBot.runtime?.monthlyTokens?.toLocaleString() ?? 0}</p></div>
                    <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5"><p className="text-[11px] uppercase tracking-wider text-zinc-400">Presupuesto</p><p className="mt-1 font-semibold text-white text-base">${selectedBot.runtime?.monthlyCostUsd ?? 0}</p></div>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="text-sm font-semibold text-zinc-200">Consumo actual</p>
                  <div className="mt-4 space-y-2.5 text-xs text-zinc-400">
                    {selectedBot.usage.map((usage) => (
                      <div key={usage.channel} className="rounded-xl border border-white/5 bg-zinc-950/60 p-3.5">
                        <p className="font-medium capitalize text-zinc-200">{usage.channel}</p>
                        <p className="mt-1 font-mono text-[11px]">{usage.messages || usage.emails} operaciones · {(usage.input_tokens + usage.output_tokens).toLocaleString()} tokens · ${Number(usage.estimated_cost_usd).toFixed(4)}</p>
                      </div>
                    ))}
                    {!selectedBot.usage.length && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-zinc-400">Sin consumo registrado este mes.</p>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="recovery" className="mt-0">
                <div className="rounded-xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
                  <p className="text-sm font-semibold text-zinc-200">Recuperación y exportación</p>
                  <p className="mt-1 text-xs text-zinc-400">Estas acciones no cambian el modo de respuesta del bot.</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" disabled={actionLoading === "recoveryDrill"} onClick={() => void runAction("recoveryDrill")}><DatabaseBackup className="mr-2 h-4 w-4" /> Ejecutar simulacro</Button>
                    <Button variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" disabled={actionLoading === "export"} onClick={() => void exportBot()}><Download className="mr-2 h-4 w-4" /> Exportar configuración</Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </Card>
      )}

      {/* Cola de fallos (Glassmorphic Container) */}
      <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
        <div className="border-b border-white/10 bg-zinc-950/60 px-6 py-4">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> Cola de fallos ({failures.length})
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            Reintentos automáticos controlados; si se agotan pasan a intervención humana.
          </p>
        </div>
        {!failures.length ? (
          <p className="px-6 py-10 text-center text-sm text-zinc-400">
            No hay operaciones pendientes ni fallos registrados. Todo funcionando normalmente.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {failures.map(({ bot, failure }) => (
              <div key={failure.id} className="flex flex-wrap items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.02]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">
                    {bot.clientName} · <span className="font-mono text-zinc-300 text-xs">{failure.operation}</span>
                  </p>
                  <p className="truncate text-xs text-zinc-400 mt-0.5">{failure.message}</p>
                  <p className="text-[11px] font-mono text-zinc-500 mt-1">
                    {failure.source} · intento {failure.attempts}/{failure.maxAttempts} ·{" "}
                    {failure.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 rounded-lg border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs" onClick={() => void retryFailure(bot.slug, failure.id)}>
                    {failure.status === "intervention" ? "Reintentar manualmente" : "Reintentar"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs text-zinc-400 hover:text-white" onClick={() => void resolveFailure(bot.slug, failure.id)}>
                    Marcar resuelto
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Feed de alertas (Glassmorphic Container) */}
      <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40">
        <div className="border-b border-white/10 bg-zinc-950/60 px-6 py-4">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" /> Alertas recientes
          </h3>
        </div>
        {(data?.alerts ?? []).length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-zinc-400">
            Sin alertas. Todos los sistemas operando con normalidad. 🎉
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {(data?.alerts ?? []).map((a) => {
              const activa = !a.resolved_at;
              return (
                <li key={a.id} className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-white/[0.02]">
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border",
                      activa ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                    )}
                  >
                    {activa ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">{a.message}</p>
                    <p className="text-[11px] font-mono text-zinc-400 mt-1">
                      {timeAgo(a.created_at)}
                      {a.resolved_at ? ` · resuelta ${timeAgo(a.resolved_at)}` : " · activa"}
                    </p>
                  </div>
                  {activa ? (
                    <Badge variant="destructive" className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium border-rose-500/30 bg-rose-500/20 text-rose-300">
                      Activa
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium border-white/10 bg-white/5 text-zinc-400">
                      Resuelta
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-center text-xs text-zinc-500">
        El monitor corre mientras el Owner Console está abierto. Para avisos 24/7 con la consola
        cerrada, se puede agregar un chequeo programado en segundo plano.
      </p>
    </div>
  );
}

function SeverityBadge({ severity, label }: { severity: Severity; label: string }) {
  const map: Record<Severity, string> = {
    ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    warn: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    down: "border-rose-500/20 bg-rose-500/10 text-rose-400",
    unknown: "border-white/10 bg-white/5 text-zinc-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide",
        map[severity],
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          severity === "ok" && "bg-emerald-400 animate-pulse",
          severity === "warn" && "bg-amber-400",
          severity === "down" && "bg-rose-400 animate-pulse",
          severity === "unknown" && "bg-zinc-500",
        )}
      />
      {label}
    </span>
  );
}

function WhatsappBadge({ state, numero }: { state: BotHealth["whatsapp"]; numero: string | null }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
        <Wifi className="h-3 w-3" />
        {numero ? `+${numero}` : "Conectado"}
      </span>
    );
  }
  if (state === "disconnected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
        <WifiOff className="h-3 w-3 text-zinc-500" /> Desconectado
      </span>
    );
  }
  return <span className="text-xs text-zinc-500 font-mono">—</span>;
}

function notifyDesktop(message: string) {
  try {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification("Stage AI Labs — Alerta", { body: message });
    }
  } catch {
    /* notificaciones no disponibles */
  }
}

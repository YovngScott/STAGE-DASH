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
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Operación</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Salud de los bots</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Estado en vivo de cada bot y su WhatsApp. Se refresca solo cada 30 s.
            {data?.checkedAt && (
              <span className="ml-1">Última revisión {timeAgo(data.checkedAt)}.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Actualizar
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </Card>
      )}

      {summary && summary.down > 0 && (
        <Card className="border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-center gap-3">
            <ServerCrash className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                {summary.down} bot{summary.down === 1 ? "" : "s"} caído
                {summary.down === 1 ? "" : "s"} ahora mismo
              </p>
              <p className="text-xs text-muted-foreground">
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

      {/* Tabla de bots */}
      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Bots ({bots.length})
          </h3>
        </div>
        {bots.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay bots desplegados. Créalos desde el Bot Builder.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead className="text-right">Revisado</TableHead>
                <TableHead className="text-right">Control</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((b) => (
                <TableRow key={b.botId}>
                  <TableCell className="font-medium">{b.clientName}</TableCell>
                  <TableCell>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm">{b.name}</span>
                      <span className="text-[11px] text-muted-foreground">
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
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {timeAgo(b.checkedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={b.status === "active" ? "destructive" : "outline"}
                      disabled={toggling === b.botId || !b.host}
                      onClick={() => void toggleBot(b, b.status !== "active")}
                    >
                      {toggling === b.botId ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Power className="mr-2 h-3.5 w-3.5" />
                      )}
                      {b.status === "active" ? "Pausa de emergencia" : "Reactivar"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {selectedBot && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-primary" /> Control de producción
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">Modo sombra, pruebas reales, consumo, intervención y recuperación.</p>
            </div>
            <select
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              value={selectedBot.slug}
              onChange={(event) => setSelectedSlug(event.target.value)}
            >
              {bots.map((bot) => <option key={bot.slug} value={bot.slug}>{bot.clientName} · {bot.name}</option>)}
            </select>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-3">
            <div className="space-y-4 rounded-lg border border-border/60 p-4">
              <div>
                <p className="text-sm font-medium">Envío automático</p>
                <p className="text-xs text-muted-foreground">Sombra redacta sin enviar; gradual libera un porcentaje estable.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["shadow", "limited", "live", "paused"] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={selectedBot.runtime?.mode === mode ? "default" : "outline"}
                    disabled={actionLoading === "runtime"}
                    onClick={() => void runAction("runtime", { payload: { mode, autoSendPercentage: mode === "limited" ? Math.max(10, selectedBot.runtime?.autoSendPercentage ?? 10) : mode === "live" ? 100 : 0 } })}
                  >
                    {mode === "shadow" ? "Sombra" : mode === "limited" ? "Gradual" : mode === "live" ? "En vivo" : "Pausado"}
                  </Button>
                ))}
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <p><strong>{selectedBot.runtime?.autoSendPercentage ?? 0}%</strong> de envío automático</p>
                <p className="mt-1 text-muted-foreground">Límites: {selectedBot.runtime?.monthlyMessages ?? 0} mensajes · {selectedBot.runtime?.monthlyEmails ?? 0} correos · ${selectedBot.runtime?.monthlyCostUsd ?? 0}/mes</p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {selectedBot.usage.map((usage) => (
                  <p key={usage.channel}>{usage.channel}: {usage.messages || usage.emails} operaciones · {(usage.input_tokens + usage.output_tokens).toLocaleString()} tokens · ${Number(usage.estimated_cost_usd).toFixed(4)}</p>
                ))}
                {!selectedBot.usage.length && <p>Sin consumo registrado este mes.</p>}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-border/60 p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium"><FlaskConical className="h-4 w-4 text-primary" /> Pruebas reales de canal</p>
                <p className="text-xs text-muted-foreground">Se envía un reto real; la prueba termina cuando el canal recibe y responde el código.</p>
              </div>
              <div className="space-y-2">
                <input className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="Correo de prueba" value={emailTestDestination} onChange={(e) => setEmailTestDestination(e.target.value)} />
                <Button size="sm" className="w-full" variant="outline" disabled={!emailTestDestination || actionLoading === "channelTest"} onClick={() => void runAction("channelTest", { channel: "email", payload: { destination: emailTestDestination } })}>Probar Gmail real</Button>
              </div>
              <div className="space-y-2">
                <input className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="WhatsApp +1809…" value={whatsappTestDestination} onChange={(e) => setWhatsappTestDestination(e.target.value)} />
                <Button size="sm" className="w-full" variant="outline" disabled={!whatsappTestDestination || actionLoading === "channelTest"} onClick={() => void runAction("channelTest", { channel: "whatsapp", payload: { destination: whatsappTestDestination } })}>Probar WhatsApp real</Button>
              </div>
              <div className="max-h-28 space-y-1 overflow-auto text-xs">
                {selectedBot.channelTests.slice(0, 5).map((run) => <p key={run.id}><Badge variant={run.status === "passed" ? "secondary" : run.status === "failed" ? "destructive" : "outline"}>{run.status}</Badge> <span className="ml-1 text-muted-foreground">{run.channel} · {run.destination}</span></p>)}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-border/60 p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium"><UserRound className="h-4 w-4 text-primary" /> Intervención humana</p>
                <p className="text-xs text-muted-foreground">Mientras esté tomada, el bot conserva mensajes pero no responde.</p>
              </div>
              <div className="max-h-28 space-y-2 overflow-auto">
                {selectedBot.handoffs.map((item) => (
                  <div key={`${item.channel}:${item.conversation_id}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-xs">
                    <span className="truncate">{item.channel} · {item.conversation_id}</span>
                    <Button size="sm" variant="ghost" onClick={() => void runAction("return", { channel: item.channel, conversationId: item.conversation_id })}>Devolver al bot</Button>
                  </div>
                ))}
                {!selectedBot.handoffs.length && <p className="text-xs text-muted-foreground">Ninguna conversación tomada.</p>}
              </div>
              <div className="border-t border-border/60 pt-3">
                <p className="mb-2 text-xs font-medium">Conversaciones recientes</p>
                <div className="max-h-32 space-y-2 overflow-auto">
                  {selectedBot.conversations
                    .filter((conversation, index, all) => all.findIndex((item) => item.channel === conversation.channel && item.id === conversation.id) === index)
                    .filter((conversation) => !selectedBot.handoffs.some((handoff) => handoff.channel === conversation.channel && handoff.conversation_id === conversation.id))
                    .slice(0, 8)
                    .map((conversation) => (
                      <div key={`${conversation.channel}:${conversation.id}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-xs">
                        <span className="min-w-0 truncate">{conversation.channel} · {conversation.contact}{conversation.subject ? ` · ${conversation.subject}` : ""}</span>
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => void runAction("take", { channel: conversation.channel, conversationId: conversation.id, payload: { reason: "Tomada desde Owner Console" } })}>Tomar</Button>
                      </div>
                    ))}
                </div>
              </div>
              <div className="border-t border-border/60 pt-3">
                <p className="text-xs font-medium">Respuestas en sombra pendientes: {selectedBot.shadows.filter((item) => !item.reviewed).length}</p>
                <div className="mt-2 max-h-28 space-y-2 overflow-auto">
                  {selectedBot.shadows.filter((item) => !item.reviewed).slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-md bg-muted/40 p-2 text-xs">
                      <p className="line-clamp-2 text-muted-foreground">{item.proposed_response}</p>
                      <Button size="sm" variant="ghost" className="mt-1 h-7" onClick={() => void runAction("reviewShadow", { id: item.id, payload: {} })}>Marcar revisada</Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
                <Button size="sm" variant="outline" disabled={actionLoading === "recoveryDrill"} onClick={() => void runAction("recoveryDrill")}><DatabaseBackup className="mr-2 h-3.5 w-3.5" /> Simulacro</Button>
                <Button size="sm" variant="outline" disabled={actionLoading === "export"} onClick={() => void exportBot()}><Download className="mr-2 h-3.5 w-3.5" /> Exportar</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> Cola de fallos ({failures.length})
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Reintentos limitados, sin duplicar mensajes; al agotarse pasan a intervención.
          </p>
        </div>
        {!failures.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No hay operaciones pendientes.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {failures.map(({ bot, failure }) => (
              <div key={failure.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {bot.clientName} · {failure.operation}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{failure.message}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {failure.source} · intento {failure.attempts}/{failure.maxAttempts} ·{" "}
                    {failure.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void retryFailure(bot.slug, failure.id)}>
                    {failure.status === "intervention" ? "Reintentar manualmente" : "Reintentar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void resolveFailure(bot.slug, failure.id)}>
                    Marcar resuelto
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Feed de alertas */}
      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" /> Alertas recientes
          </h3>
        </div>
        {(data?.alerts ?? []).length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Sin alertas. Todo ha estado en orden. 🎉
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {(data?.alerts ?? []).map((a) => {
              const activa = !a.resolved_at;
              return (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      activa ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                    )}
                  >
                    {activa ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.message}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {timeAgo(a.created_at)}
                      {a.resolved_at ? ` · resuelta ${timeAgo(a.resolved_at)}` : " · activa"}
                    </p>
                  </div>
                  {activa ? (
                    <Badge variant="destructive" className="shrink-0">
                      Activa
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">
                      Resuelta
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        El monitor corre mientras el Owner Console está abierto. Para avisos 24/7 con la consola
        cerrada, se puede agregar un chequeo programado (siguiente fase).
      </p>
    </div>
  );
}

function SeverityBadge({ severity, label }: { severity: Severity; label: string }) {
  const map: Record<Severity, string> = {
    ok: "border-success/30 bg-success/10 text-success",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    down: "border-destructive/30 bg-destructive/10 text-destructive",
    unknown: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        map[severity],
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          severity === "ok" && "bg-success animate-pulse",
          severity === "warn" && "bg-amber-500",
          severity === "down" && "bg-destructive animate-pulse",
          severity === "unknown" && "bg-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}

function WhatsappBadge({ state, numero }: { state: BotHealth["whatsapp"]; numero: string | null }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <Wifi className="h-3.5 w-3.5" />
        {numero ? `+${numero}` : "Conectado"}
      </span>
    );
  }
  if (state === "disconnected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <WifiOff className="h-3.5 w-3.5" /> Desconectado
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
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

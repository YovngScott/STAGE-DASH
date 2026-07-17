import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ServerCrash,
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
  const summary = data?.summary;
  const activeAlerts = useMemo(() => (data?.alerts ?? []).filter((a) => !a.resolved_at), [data]);

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
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

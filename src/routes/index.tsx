import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Wallet,
  Users,
  Receipt,
  Percent,
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Eye,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  ExternalLink,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/hooks/use-language";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

interface Client {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  mrr: number;
  billing_cycle: string;
  next_billing_date: string | null;
  services: string[] | null;
  notes: string | null;
  created_at: string;
  bot_status_url: string | null;
  bot_secret: string | null;
  bot_activo: boolean;
}

interface LedgerEntry {
  id: string;
  date: string;
  amount: number;
  kind: "investment" | "expense";
  category: string;
}

interface BotHealth {
  botId: string;
  clientId: string | null;
  name: string;
  slug: string;
  kind: string;
  status: string;
  clientName: string;
  host: string | null;
  reachable: boolean;
  whatsapp: "connected" | "disconnected" | "unknown";
  numero: string | null;
  email: "connected" | "disconnected" | "not_applicable" | "unknown";
  averageLatencyMs: number;
  pendingFailures: number;
  severity: "ok" | "warn" | "down" | "unknown";
  statusLabel: string;
  runtime: { monthlyCostUsd: number } | null;
}

function monthLabel(dateStr: string, locale: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(locale, {
    month: "short",
    year: "2-digit",
  });
}

function Dashboard() {
  const { language, locale, text } = useLanguage();
  const [clients, setClients] = useState<Client[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [bots, setBots] = useState<BotHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const [cRes, lRes, hRes] = await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: true }),
        supabase.from("ledger_entries").select("id,date,amount,kind,category"),
        fetch("/api/bot-health", {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        }).then((r) => r.json()).catch(() => null),
      ]);

      if (!cRes.error) setClients((cRes.data ?? []) as Client[]);
      if (!lRes.error) setEntries((lRes.data ?? []) as LedgerEntry[]);
      if (hRes && hRes.bots) setBots(hRes.bots as BotHealth[]);
    } catch (e) {
      console.error("[Dashboard] Error loading dashboard data:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const activeClients = useMemo(() => clients.filter((c) => c.status === "active"), [clients]);
  const mrr = activeClients.reduce((s, c) => s + Number(c.mrr), 0);
  
  // Costos API consolidados
  const totalApiCosts = useMemo(() => bots.reduce((s, b) => s + (b.runtime?.monthlyCostUsd ?? 0), 0), [bots]);

  const totalInvestments = entries
    .filter((e) => e.kind === "investment")
    .reduce((s, e) => s + Number(e.amount), 0);
  const monthlyExpenses = entries
    .filter((e) => e.kind === "expense")
    .reduce((s, e) => s + Number(e.amount), 0);

  // Total de gastos consolidados = gastos operativos registrados + costos de API
  const consolidatedExpenses = monthlyExpenses + totalApiCosts;
  const profit = mrr - consolidatedExpenses;
  const margin = mrr > 0 ? ((profit / mrr) * 100).toFixed(1) : "0.0";
  const runwayMonths = consolidatedExpenses > 0 ? (totalInvestments / consolidatedExpenses).toFixed(1) : "—";

  const handleReconnect = async (bot: BotHealth) => {
    setReconnecting(bot.botId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/bot-health", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "reconnect-whatsapp",
          slug: bot.slug,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        toast.success(
          language === "es"
            ? `Sesión de WhatsApp de ${bot.clientName} reiniciada.`
            : `WhatsApp session for ${bot.clientName} restarted.`
        );
      } else {
        throw new Error(data?.error || "Error al reiniciar la sesión.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reconectar WhatsApp.");
    } finally {
      setReconnecting(null);
      void loadData(true);
    }
  };

  const handleImpersonate = async (clientId: string, slug: string) => {
    setImpersonating(clientId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const bot = bots.find((b) => b.slug === slug);
      const host = bot?.host || "https://wiltech-bot.fly.dev";
      const dashboardUrl = `${host}/?tenant=${slug}&api=${host}`;

      const res = await fetch("/api/impersonate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          tenantSlug: slug,
          redirectTo: dashboardUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        toast.success(
          language === "es" ? "Acceso concedido. Abriendo pestaña..." : "Access granted. Opening tab..."
        );
        window.open(data.url, "_blank");
      } else {
        throw new Error(data?.error || "No se pudo generar el enlace de impersonación.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fallo de impersonación.");
    } finally {
      setImpersonating(null);
    }
  };

  const monthlySeries = useMemo(() => {
    const buckets = new Map<
      string,
      { month: string; investments: number; expenses: number; sort: string }
    >();
    for (const e of entries) {
      const sort = e.date.slice(0, 7);
      const month = monthLabel(e.date, locale);
      if (!buckets.has(sort)) buckets.set(sort, { month, investments: 0, expenses: 0, sort });
      const bucket = buckets.get(sort)!;
      if (e.kind === "investment") bucket.investments += Number(e.amount);
      else bucket.expenses += Number(e.amount);
    }
    return Array.from(buckets.values()).sort((a, b) => a.sort.localeCompare(b.sort));
  }, [entries, locale]);

  const monthlyChartConfig = {
    investments: { label: text("Inversiones", "Investments"), color: "var(--chart-1)" },
    expenses: { label: text("Gastos", "Expenses"), color: "var(--chart-3)" },
  };
  const categoryChartConfig = {
    amount: { label: text("Monto", "Amount"), color: "var(--chart-3)" },
  };

  const categorySeries = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const e of entries.filter((e) => e.kind === "expense")) {
      buckets.set(e.category, (buckets.get(e.category) ?? 0) + Number(e.amount));
    }
    // Añadir costos de API como una categoría de gasto si existen
    if (totalApiCosts > 0) {
      buckets.set("API (Bots)", (buckets.get("API (Bots)") ?? 0) + totalApiCosts);
    }
    return Array.from(buckets.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [entries, totalApiCosts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
        {text("Cargando panel…", "Loading dashboard…")}
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
            {text("Consola de Dueño", "Owner Console")}
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {text("Resumen de Stage AI Labs", "Stage AI Labs Overview")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base leading-relaxed">
            {text(
              "Monitoreo financiero global, métricas de consumo API y salud en vivo de bots.",
              "Global financial monitoring, API consumption metrics, and live bot health status.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-xl border-white/10 bg-zinc-900/60 px-4 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white backdrop-blur-md gap-2 shrink-0 transition-all shadow-md"
          onClick={() => void loadData(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {text("Sincronizar", "Sync")}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={text("MRR total", "Total MRR")}
          value={`$${mrr.toLocaleString()}`}
          delta={
            language === "es"
              ? `De ${activeClients.length} cliente${activeClients.length === 1 ? "" : "s"} activo${activeClients.length === 1 ? "" : "s"}`
              : `From ${activeClients.length} active client${activeClients.length === 1 ? "" : "s"}`
          }
          trend="up"
          icon={DollarSign}
          accent
        />
        <KpiCard
          label={text("Costos API Totales", "Total API Costs")}
          value={`$${totalApiCosts.toFixed(2)}`}
          delta={text("Groq / OpenAI / Vapi", "Groq / OpenAI / Vapi")}
          trend="neutral"
          icon={Wallet}
        />
        <KpiCard
          label={text("Clientes activos", "Active Clients")}
          value={String(activeClients.length)}
          delta={text(`${clients.length} registrados`, `${clients.length} registered`)}
          trend="up"
          icon={Users}
        />
        <KpiCard
          label={text("Gastos mensuales", "Monthly Expenses")}
          value={`$${consolidatedExpenses.toLocaleString()}`}
          delta={text("Operativos + Costos API", "Operational + API Spend")}
          trend="down"
          icon={Receipt}
        />
        <KpiCard
          label={text("Margen neto", "Net Profit Margin")}
          value={`${margin}%`}
          delta={text(`$${profit.toLocaleString()} netos`, `$${profit.toLocaleString()} cleared`)}
          trend={profit >= 0 ? "up" : "down"}
          icon={Percent}
          accent
        />
      </div>

      {/* SALUD DE BOTS GRID */}
      <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-6">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              {text("Tablero de Salud de Bots", "Bot Connection & Health Grid")}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {text("Comandos rápidos y estado de conexión de mensajería y voz", "Live connectivity and rapid command controls")}
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          {bots.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">
              {text("No se encontraron bots activos.", "No active bots found.")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/10 hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Cliente", "Client")}</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Tipo", "Type")}</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Estado Servidor", "Server Health")}</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("WhatsApp", "WhatsApp")}</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Correo", "Email")}</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Operaciones Pendientes", "Pending Ops")}</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Costo API (Mes)", "API Cost (Mo)")}</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Comandos", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((bot) => {
                  const isWhatsAppConnected = bot.whatsapp === "connected";
                  const isServerReachable = bot.reachable;
                  const isEmailConnected = bot.email === "connected";

                  return (
                    <TableRow key={bot.botId} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                      <TableCell className="font-medium text-white">{bot.clientName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-[11px] font-normal border-white/10 bg-white/5 text-zinc-300">
                          {bot.kind}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          {isServerReachable ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              <span className="text-zinc-300">{text("Activo", "Online")}</span>
                            </>
                          ) : (
                            <>
                              <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                              <span className="text-rose-400 font-medium">{text("Caído", "Offline")}</span>
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          {bot.kind === "voice" ? (
                            <span className="text-zinc-500 font-mono">—</span>
                          ) : isWhatsAppConnected ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              <span className="text-zinc-300">{text("Conectado", "Connected")}</span>
                            </>
                          ) : (
                            <>
                              <span className="h-2 w-2 rounded-full bg-zinc-500" />
                              <span className="text-zinc-400">
                                {text("Desconectado", "Disconnected")}
                              </span>
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs">
                          {bot.email === "not_applicable" ? (
                            <span className="text-zinc-500 font-mono">—</span>
                          ) : isEmailConnected ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              <span className="text-zinc-300">{text("Conectado", "Connected")}</span>
                            </>
                          ) : (
                            <>
                              <span className="h-2 w-2 rounded-full bg-amber-400" />
                              <span className="text-amber-300">
                                {text("Desconectado", "Disconnected")}
                              </span>
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {bot.pendingFailures > 0 ? (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px]">
                            {bot.pendingFailures} {text("Fallas", "Failures")}
                          </Badge>
                        ) : (
                          <span className="text-zinc-500 font-mono text-xs">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium font-mono text-zinc-200">
                        ${(bot.runtime?.monthlyCostUsd ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          {bot.kind !== "voice" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 text-xs px-2.5 transition-all"
                              onClick={() => void handleReconnect(bot)}
                              disabled={reconnecting === bot.botId}
                            >
                              {reconnecting === bot.botId ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="h-3 w-3 mr-1" />
                              )}
                              {text("Reconectar", "Reconnect")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="h-8 rounded-lg text-xs px-3 gap-1.5 shadow-sm transition-all"
                            onClick={() => {
                              const client = clients.find(c => c.company_name === bot.clientName);
                              if (client) void handleImpersonate(client.id, bot.slug);
                              else toast.error("No se pudo asociar el cliente.");
                            }}
                            disabled={impersonating !== null}
                          >
                            {impersonating === clients.find(c => c.company_name === bot.clientName)?.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                            {text("Entrar", "Login")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      {/* DETALLE FINANCIERO Y MARGENES POR CLIENTE */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-6">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
                {text("Desglose Financiero por Cliente", "Client MRR & Margins Breakdown")}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {text("Ingresos de suscripción versus costo de consumo de infraestructura", "Client subscription revenue versus live API usage costs")}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-white/10 hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Empresa", "Company")}</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Servicios", "Services")}</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("MRR Cobrado", "MRR Billed")}</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Costo API (Bot)", "API cost")}</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Margen Neto", "Net profit")}</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Estado Pago", "Status")}</TableHead>
                  <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400 py-3.5">{text("Panel", "Console")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeClients.map((client) => {
                  const bot = bots.find((b) => b.clientName === client.company_name);
                  const botApiCost = bot?.runtime?.monthlyCostUsd ?? 0;
                  const clientProfit = Number(client.mrr) - botApiCost;
                  const clientMargin = Number(client.mrr) > 0 ? ((clientProfit / Number(client.mrr)) * 100).toFixed(1) : "0.0";

                  return (
                    <TableRow key={client.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                      <TableCell className="font-medium text-white">{client.company_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(client.services ?? []).map((s, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] py-0 px-1 font-normal border-white/10 bg-white/5 text-zinc-300">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-zinc-200 font-mono">${Number(client.mrr).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-zinc-400 font-mono text-xs">${botApiCost.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-400 font-mono">
                        ${clientProfit.toLocaleString()} ({clientMargin}%)
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-medium rounded-full">
                          {text("Al día", "Cleared")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-zinc-400 hover:text-white rounded-lg transition-colors"
                          onClick={() => {
                            const slug = bot?.slug || client.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                            void handleImpersonate(client.id, slug);
                          }}
                          disabled={impersonating !== null}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* GASTOS POR CATEGORIA */}
        <Card className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-6">
          <h3 className="text-sm font-semibold tracking-tight text-zinc-100">
            {text("Gastos por categoría", "Expenses by Category")}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {text("Distribución de los gastos operativos", "Where operational spend goes")}
          </p>
          <div className="mt-4 h-[200px]">
            {categorySeries.length === 0 ? (
              <EmptyChartState
                message={text("Aún no hay gastos registrados.", "No expenses logged yet.")}
              />
            ) : (
              <ChartContainer config={categoryChartConfig} className="h-full w-full">
                <ResponsiveContainer>
                  <BarChart data={categorySeries} margin={{ left: 0, right: 8, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="category"
                      tickLine={false}
                      axisLine={false}
                      tick={false}
                      height={8}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "rgba(255,255,255,0.05)" }}
                    />
                    <Bar dataKey="amount" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            <RunwayLine
              label={text("Meses de caja", "Cash Runway")}
              value={
                runwayMonths === "—" ? "—" : text(`${runwayMonths} meses`, `${runwayMonths} months`)
              }
            />
            <RunwayLine
              label={text("Tasa de gasto", "Burn Rate")}
              value={`$${consolidatedExpenses.toLocaleString()} / ${text("mes", "mo")}`}
            />
            <RunwayLine
              label={text("Punto de equilibrio", "Break-even")}
              value={profit >= 0 ? text("Alcanzado ✓", "Reached ✓") : text("Aún no", "Not yet")}
              positive={profit >= 0}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground px-6">
      {message}
    </div>
  );
}

function RunwayLine({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={positive ? "font-medium text-success" : "font-medium"}>{value}</span>
    </div>
  );
}

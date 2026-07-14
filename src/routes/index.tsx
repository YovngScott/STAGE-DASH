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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const monthlyChartConfig = {
  investments: { label: "Investments", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-3)" },
};

const categoryChartConfig = {
  amount: { label: "Amount", color: "var(--chart-3)" },
};

interface Client {
  id: string;
  mrr: number;
  status: string;
}

interface LedgerEntry {
  id: string;
  date: string;
  amount: number;
  kind: "investment" | "expense";
  category: string;
}

function monthLabel(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function Dashboard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [cRes, lRes] = await Promise.all([
        supabase.from("clients").select("id,mrr,status"),
        supabase.from("ledger_entries").select("id,date,amount,kind,category"),
      ]);
      if (!cRes.error) setClients((cRes.data ?? []) as Client[]);
      if (!lRes.error) setEntries((lRes.data ?? []) as LedgerEntry[]);
      setLoading(false);
    })();
  }, []);

  const activeClients = useMemo(() => clients.filter((c) => c.status === "active"), [clients]);
  const mrr = activeClients.reduce((s, c) => s + Number(c.mrr), 0);
  const totalInvestments = entries
    .filter((e) => e.kind === "investment")
    .reduce((s, e) => s + Number(e.amount), 0);
  const monthlyExpenses = entries
    .filter((e) => e.kind === "expense")
    .reduce((s, e) => s + Number(e.amount), 0);
  const profit = mrr - monthlyExpenses;
  const margin = mrr > 0 ? ((profit / mrr) * 100).toFixed(1) : "0.0";
  const runwayMonths = monthlyExpenses > 0 ? (totalInvestments / monthlyExpenses).toFixed(1) : "—";

  const monthlySeries = useMemo(() => {
    const buckets = new Map<string, { month: string; investments: number; expenses: number; sort: string }>();
    for (const e of entries) {
      const sort = e.date.slice(0, 7);
      const month = monthLabel(e.date);
      if (!buckets.has(sort)) buckets.set(sort, { month, investments: 0, expenses: 0, sort });
      const bucket = buckets.get(sort)!;
      if (e.kind === "investment") bucket.investments += Number(e.amount);
      else bucket.expenses += Number(e.amount);
    }
    return Array.from(buckets.values()).sort((a, b) => a.sort.localeCompare(b.sort));
  }, [entries]);

  const categorySeries = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const e of entries.filter((e) => e.kind === "expense")) {
      buckets.set(e.category, (buckets.get(e.category) ?? 0) + Number(e.amount));
    }
    return Array.from(buckets.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [entries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Global Overview
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Welcome back to Stage AI Labs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time snapshot of MRR, expenses, and product health.
          </p>
        </div>
        <Button variant="default" className="gap-2">
          New Report <ArrowUpRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Total MRR"
          value={`$${mrr.toLocaleString()}`}
          delta={`From ${activeClients.length} active client${activeClients.length === 1 ? "" : "s"}`}
          trend="up"
          icon={DollarSign}
          accent
        />
        <KpiCard
          label="Total Investments"
          value={`$${totalInvestments.toLocaleString()}`}
          delta="Personal capital"
          trend="neutral"
          icon={Wallet}
        />
        <KpiCard
          label="Active Clients"
          value={String(activeClients.length)}
          delta={`${clients.length} total on file`}
          trend="up"
          icon={Users}
        />
        <KpiCard
          label="Monthly Expenses"
          value={`$${monthlyExpenses.toLocaleString()}`}
          delta="Logged operational costs"
          trend="down"
          icon={Receipt}
        />
        <KpiCard
          label="Net Profit Margin"
          value={`${margin}%`}
          delta={`$${profit.toLocaleString()} cleared`}
          trend={profit >= 0 ? "up" : "down"}
          icon={Percent}
          accent
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2 border-border/60 p-6"
          style={{ background: "var(--gradient-card)" }}
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">
                Investments vs Expenses
              </h3>
              <p className="text-xs text-muted-foreground">
                By month, from logged ledger transactions
              </p>
            </div>
            <div className="flex gap-3 text-[11px]">
              <LegendDot label="Investments" color="var(--chart-1)" />
              <LegendDot label="Expenses" color="var(--chart-3)" />
            </div>
          </div>
          <div className="mt-6 h-[320px]">
            {monthlySeries.length === 0 ? (
              <EmptyChartState message="Log transactions in the Financial Ledger to see this trend." />
            ) : (
              <ChartContainer config={monthlyChartConfig} className="h-full w-full">
                <ResponsiveContainer>
                  <AreaChart data={monthlySeries} margin={{ left: 4, right: 12, top: 8 }}>
                    <defs>
                      <linearGradient id="inv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="investments" stroke="var(--chart-1)" strokeWidth={2} fill="url(#inv)" />
                    <Area type="monotone" dataKey="expenses" stroke="var(--chart-3)" strokeWidth={2} fill="url(#exp)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="border-border/60 p-6">
          <h3 className="text-sm font-semibold tracking-tight">Expenses by Category</h3>
          <p className="text-xs text-muted-foreground">Where operational spend goes</p>
          <div className="mt-4 h-[200px]">
            {categorySeries.length === 0 ? (
              <EmptyChartState message="No expenses logged yet." />
            ) : (
              <ChartContainer config={categoryChartConfig} className="h-full w-full">
                <ResponsiveContainer>
                  <BarChart data={categorySeries} margin={{ left: 0, right: 8, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="amount" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
          <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
            <RunwayLine label="Cash Runway" value={runwayMonths === "—" ? "—" : `${runwayMonths} months`} />
            <RunwayLine label="Burn Rate" value={`$${monthlyExpenses.toLocaleString()} / mo`} />
            <RunwayLine label="Break-even" value={profit >= 0 ? "Reached ✓" : "Not yet"} positive={profit >= 0} />
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

function RunwayLine({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={positive ? "font-medium text-success" : "font-medium"}>{value}</span>
    </div>
  );
}

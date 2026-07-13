import { createFileRoute } from "@tanstack/react-router";
import {
  DollarSign,
  Wallet,
  Users,
  Receipt,
  Percent,
  ArrowUpRight,
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

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const monthly = [
  { month: "Feb", revenue: 350, expenses: 180, profit: 170 },
  { month: "Mar", revenue: 500, expenses: 210, profit: 290 },
  { month: "Apr", revenue: 500, expenses: 245, profit: 255 },
  { month: "May", revenue: 700, expenses: 280, profit: 420 },
  { month: "Jun", revenue: 850, expenses: 305, profit: 545 },
  { month: "Jul", revenue: 850, expenses: 320, profit: 530 },
];

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-3)" },
  profit: { label: "Net Profit", color: "var(--chart-2)" },
};

function Dashboard() {
  const mrr = 850;
  const expenses = 320;
  const profit = mrr - expenses;
  const margin = ((profit / mrr) * 100).toFixed(1);

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Global Overview · July 2026
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
          delta="+21.4% MoM"
          trend="up"
          icon={DollarSign}
          accent
        />
        <KpiCard
          label="Total Investments"
          value="$12,480"
          delta="Personal capital"
          trend="neutral"
          icon={Wallet}
        />
        <KpiCard
          label="Active Clients"
          value="2"
          delta="+1 in pilot"
          trend="up"
          icon={Users}
        />
        <KpiCard
          label="Monthly Expenses"
          value={`$${expenses}`}
          delta="+4.9% vs Jun"
          trend="down"
          icon={Receipt}
        />
        <KpiCard
          label="Net Profit Margin"
          value={`${margin}%`}
          delta={`$${profit} cleared`}
          trend="up"
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
                Revenue vs Expenses vs Net Profit
              </h3>
              <p className="text-xs text-muted-foreground">
                Rolling 6-month view — USD
              </p>
            </div>
            <div className="flex gap-3 text-[11px]">
              <LegendDot label="Revenue" color="var(--chart-1)" />
              <LegendDot label="Expenses" color="var(--chart-3)" />
              <LegendDot label="Profit" color="var(--chart-2)" />
            </div>
          </div>
          <div className="mt-6 h-[320px]">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <ResponsiveContainer>
                <AreaChart data={monthly} margin={{ left: 4, right: 12, top: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
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
                  <Area type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#rev)" />
                  <Area type="monotone" dataKey="expenses" stroke="var(--chart-3)" strokeWidth={2} fill="url(#exp)" />
                  <Area type="monotone" dataKey="profit" stroke="var(--chart-2)" strokeWidth={2} fill="url(#prof)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </Card>

        <Card className="border-border/60 p-6">
          <h3 className="text-sm font-semibold tracking-tight">Profit Trajectory</h3>
          <p className="text-xs text-muted-foreground">Net profit per month</p>
          <div className="mt-4 h-[200px]">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <ResponsiveContainer>
                <BarChart data={monthly} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="profit" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
          <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
            <RunwayLine label="Cash Runway" value="8.2 months" />
            <RunwayLine label="Burn Rate" value="$320 / mo" />
            <RunwayLine label="Break-even" value="Reached ✓" positive />
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

function RunwayLine({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={positive ? "font-medium text-success" : "font-medium"}>{value}</span>
    </div>
  );
}

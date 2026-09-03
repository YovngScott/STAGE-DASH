import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
  icon: LucideIcon;
  accent?: boolean;
}

export function KpiCard({ label, value, delta, trend = "up", icon: Icon, accent }: KpiCardProps) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-5 sm:p-6 backdrop-blur-xl",
        "shadow-xl shadow-black/30 transition-all duration-300 hover:border-white/20 hover:shadow-black/50"
      )}
      style={{
        background: accent ? "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            {label}
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">{value}</p>
          {delta && (
            <div
              className={cn(
                "mt-2.5 inline-flex items-center gap-1 text-xs font-medium",
                trend === "up" && "text-emerald-400",
                trend === "down" && "text-rose-400",
                trend === "neutral" && "text-zinc-400"
              )}
            >
              {trend === "up" ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3.5 w-3.5" />
              ) : null}
              {delta}
            </div>
          )}
        </div>
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-primary shadow-inner"
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

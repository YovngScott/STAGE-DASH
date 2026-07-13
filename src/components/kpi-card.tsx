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
        "relative overflow-hidden border-border/60 p-5",
        "transition-all hover:border-primary/40"
      )}
      style={{
        background: accent ? "var(--gradient-card)" : undefined,
        boxShadow: accent ? "var(--shadow-elegant)" : undefined,
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          {delta && (
            <div
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                trend === "up" && "text-success",
                trend === "down" && "text-destructive",
                trend === "neutral" && "text-muted-foreground"
              )}
            >
              {trend === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3 w-3" />
              ) : null}
              {delta}
            </div>
          )}
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

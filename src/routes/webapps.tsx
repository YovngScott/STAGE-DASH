import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Server, Globe2, Pizza, Wrench, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/webapps")({
  component: WebApps,
});

interface App {
  id: string;
  name: string;
  category: string;
  owner: string;
  host: string;
  stack: string[];
  status: "Online" | "Maintenance";
  url: string;
  icon: LucideIcon;
  uptime: string;
  description: string;
}

const apps: App[] = [
  {
    id: "charlotte",
    name: "Charlotte Food Hub",
    category: "Enterprise Pizza ERP",
    owner: "Charlotte Food Hub LLC",
    host: "Netlify",
    stack: ["Next.js", "PostgreSQL", "Stripe"],
    status: "Online",
    url: "https://charlottefoodhub.com",
    icon: Pizza,
    uptime: "99.98%",
    description:
      "Full ERP for pizza operations: POS, inventory, delivery routing, and financial reporting.",
  },
  {
    id: "auto-repair",
    name: "Auto Repair Tracker",
    category: "Claims & Inventory DB",
    owner: "Auto Repair Workshop",
    host: "Supabase + Vercel",
    stack: ["React", "Supabase", "Edge Functions"],
    status: "Online",
    url: "https://autorepair-tracker.app",
    icon: Wrench,
    uptime: "99.94%",
    description:
      "Tracks insurance claims, parts inventory, and mechanic workload with role-based access.",
  },
];

function WebApps() {
  const [active, setActive] = useState<App | null>(null);

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Custom Projects
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Web Apps Showcase</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deployed custom platforms · click a card for details and deployment links.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {apps.map((a) => {
          const Icon = a.icon;
          return (
            <Card
              key={a.id}
              onClick={() => setActive(a)}
              className="group relative cursor-pointer overflow-hidden border-border/60 p-6 transition-all hover:border-primary/50 hover:shadow-[var(--shadow-glow)]"
              style={{ background: "var(--gradient-card)" }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold tracking-tight">{a.name}</h3>
                    <p className="text-xs text-muted-foreground">{a.category}</p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-success/15 text-success border-success/30"
                >
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  {a.status}
                </Badge>
              </div>
              <p className="mt-4 text-sm text-muted-foreground line-clamp-2">
                {a.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {a.stack.map((s) => (
                  <Badge key={s} variant="secondary" className="font-normal">
                    {s}
                  </Badge>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Server className="h-3.5 w-3.5" />
                  {a.host}
                </span>
                <span className="font-mono font-medium text-success">{a.uptime}</span>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          {active && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <active.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <DialogTitle>{active.name}</DialogTitle>
                    <DialogDescription>{active.category}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{active.description}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Row label="Client Owner" value={active.owner} />
                  <Row label="Hosting" value={active.host} />
                  <Row label="Status" value={active.status} success />
                  <Row label="Uptime (30d)" value={active.uptime} success />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Button asChild className="gap-2 flex-1">
                    <a href={active.url} target="_blank" rel="noreferrer">
                      <Globe2 className="h-4 w-4" />
                      Visit deployment
                      <ExternalLink className="h-3.5 w-3.5 ml-auto" />
                    </a>
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={"mt-1 font-medium " + (success ? "text-success" : "")}>{value}</p>
    </div>
  );
}

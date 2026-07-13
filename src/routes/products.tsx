import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  MessageSquare,
  Phone,
  Calendar,
  Activity,
  KeyRound,
  DollarSign,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/products")({
  component: Products,
});

type Status = "Active" | "In Development" | "Testing";

interface Bot {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  status: Status;
  revenue: number;
  expenses: number;
  ping: string;
  apiKey: "Valid" | "Missing";
  costs: { label: string; value: string; pct: number }[];
}

const bots: Bot[] = [
  {
    id: "messaging",
    name: "Stage Messaging Agent",
    tagline: "Omnichannel closer · WhatsApp & Instagram DM",
    description:
      "24/7 conversational sales agent with Supabase-backed memory, handling qualification, objections, and booking across WhatsApp Business API and Instagram DMs.",
    icon: MessageSquare,
    status: "Active",
    revenue: 700,
    expenses: 145,
    ping: "112 ms",
    apiKey: "Valid",
    costs: [
      { label: "OpenAI LLM tokens", value: "$78", pct: 54 },
      { label: "Supabase (DB + Vector)", value: "$29", pct: 20 },
      { label: "WhatsApp Cloud API", value: "$24", pct: 17 },
      { label: "Meta Graph / Instagram", value: "$14", pct: 9 },
    ],
  },
  {
    id: "voice",
    name: "Stage Voice Agent",
    tagline: "Phone assistant · Twilio + Vapi / Retell",
    description:
      "Sub-second latency voice agent that answers, qualifies, and books calls. Twilio for telephony, Vapi/Retell for orchestration, Whisper for transcripts.",
    icon: Phone,
    status: "In Development",
    revenue: 0,
    expenses: 62,
    ping: "218 ms",
    apiKey: "Valid",
    costs: [
      { label: "Twilio minutes", value: "$28", pct: 45 },
      { label: "Vapi / Retell orchestration", value: "$18", pct: 29 },
      { label: "Whisper STT", value: "$9", pct: 15 },
      { label: "OpenAI LLM tokens", value: "$7", pct: 11 },
    ],
  },
  {
    id: "va",
    name: "Stage Virtual Assistant",
    tagline: "Google Workspace scheduler & reporter",
    description:
      "Autonomous VA integrated with Google Calendar, Gmail, Sheets and Drive. Schedules, drafts reports, and delivers daily/weekly digests to the operator.",
    icon: Calendar,
    status: "Testing",
    revenue: 150,
    expenses: 34,
    ping: "94 ms",
    apiKey: "Valid",
    costs: [
      { label: "OpenAI LLM tokens", value: "$21", pct: 62 },
      { label: "Google Workspace API", value: "$8", pct: 24 },
      { label: "Supabase logs", value: "$5", pct: 14 },
    ],
  },
];

const statusStyles: Record<Status, string> = {
  Active: "bg-success/15 text-success border-success/30",
  "In Development": "bg-warning/15 text-warning border-warning/30",
  Testing: "bg-primary/15 text-primary border-primary/30",
};

function Products() {
  const [active, setActive] = useState<Bot | null>(null);

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Bots Directory
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Proprietary AI Systems
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Click a card to inspect profitability, connectivity, and cost breakdowns.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bots.map((bot) => {
          const Icon = bot.icon;
          const profit = bot.revenue - bot.expenses;
          return (
            <button
              key={bot.id}
              onClick={() => setActive(bot)}
              className="group text-left"
            >
              <Card
                className="relative h-full overflow-hidden border-border/60 p-6 transition-all hover:border-primary/50 hover:shadow-[var(--shadow-glow)]"
                style={{ background: "var(--gradient-card)" }}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge variant="outline" className={statusStyles[bot.status]}>
                    {bot.status}
                  </Badge>
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">{bot.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{bot.tagline}</p>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border/60 pt-4">
                  <Stat label="Revenue" value={`$${bot.revenue}`} />
                  <Stat label="Costs" value={`$${bot.expenses}`} muted />
                  <Stat
                    label="Profit"
                    value={`$${profit}`}
                    positive={profit > 0}
                    negative={profit < 0}
                  />
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {active && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <active.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-left">{active.name}</SheetTitle>
                    <SheetDescription className="text-left">
                      {active.tagline}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="mt-6 space-y-6 px-4 pb-6">
                <p className="text-sm text-muted-foreground">{active.description}</p>

                <div className="grid grid-cols-3 gap-3">
                  <MiniCard icon={DollarSign} label="Revenue" value={`$${active.revenue}`} tone="primary" />
                  <MiniCard icon={Zap} label="Costs" value={`$${active.expenses}`} />
                  <MiniCard
                    icon={DollarSign}
                    label="Profit"
                    value={`$${active.revenue - active.expenses}`}
                    tone={active.revenue - active.expenses >= 0 ? "success" : "destructive"}
                  />
                </div>

                <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Activity className="h-4 w-4 text-success" />
                    Live Connection
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                      <span className="text-muted-foreground">Ping</span>
                      <span className="font-mono font-medium text-success">{active.ping}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <KeyRound className="h-3 w-3" /> API Key
                      </span>
                      <span className="font-medium text-success">{active.apiKey}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium">Cost Breakdown</h4>
                  <div className="mt-3 space-y-3">
                    {active.costs.map((c) => (
                      <div key={c.label}>
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{c.label}</span>
                          <span className="font-medium">{c.value}</span>
                        </div>
                        <Progress value={c.pct} className="h-1.5" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
  positive,
  negative,
}: {
  label: string;
  value: string;
  muted?: boolean;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={
          "mt-0.5 text-sm font-semibold " +
          (positive ? "text-success" : negative ? "text-destructive" : muted ? "text-muted-foreground" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function MiniCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "primary" | "success" | "destructive";
}) {
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-success"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-3">
      <Icon className={"h-3.5 w-3.5 " + toneClass} />
      <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={"mt-0.5 text-base font-semibold " + toneClass}>{value}</p>
    </div>
  );
}

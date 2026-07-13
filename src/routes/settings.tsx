import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, KeyRound, Download, Eye, EyeOff, Copy, FileSpreadsheet, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const initialKeys = [
  { id: "openai", label: "OpenAI API Key", placeholder: "sk-proj-…", value: "sk-proj-9f2••••••••••••••••••••4c1a" },
  { id: "supabase", label: "Supabase Service Role", placeholder: "eyJhbGciOi…", value: "eyJhbGciOi••••••••••••••••7Q" },
  { id: "vapi", label: "Vapi API Key", placeholder: "vapi_live_…", value: "vapi_live_••••••••••••e8" },
  { id: "twilio", label: "Twilio Auth Token", placeholder: "AC-token", value: "AC••••••••••••••••••••••••••••••••" },
  { id: "retell", label: "Retell API Key", placeholder: "rk_live_…", value: "rk_live_••••••••••••••2f" },
];

function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1200px] p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Owner Console</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Company profile, credentials vault, and data exports.
        </p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile"><Building2 className="mr-2 h-4 w-4" />Company Profile</TabsTrigger>
          <TabsTrigger value="vault"><KeyRound className="mr-2 h-4 w-4" />Credentials Vault</TabsTrigger>
          <TabsTrigger value="export"><Download className="mr-2 h-4 w-4" />Export Data</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card className="border-border/60 p-6" style={{ background: "var(--gradient-card)" }}>
            <h3 className="text-sm font-semibold tracking-tight">Registration details</h3>
            <p className="mt-1 text-xs text-muted-foreground">Wyoming filing tracker & legal identity.</p>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Legal Name" defaultValue="Stage AI Labs LLC" />
              <Field label="State of Formation" defaultValue="Wyoming, USA" />
              <Field label="EIN" defaultValue="99-1234567" />
              <Field label="Registered Agent" defaultValue="Cheyenne Registered Agents Inc." />
              <Field label="Filing Date" defaultValue="2026-01-08" />
              <Field label="Principal Address" defaultValue="30 N Gould St Ste R, Sheridan, WY 82801" />
            </div>

            <div className="mt-6 border-t border-border/60 pt-4">
              <h4 className="text-sm font-medium">Filing checklist</h4>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <Checkline label="Articles of Organization filed" done />
                <Checkline label="EIN issued by IRS" done />
                <Checkline label="Operating Agreement signed" done />
                <Checkline label="Registered agent (annual)" done />
                <Checkline label="Wyoming annual report" />
                <Checkline label="Bank account (Mercury / Relay)" done />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="vault" className="mt-4">
          <Card className="border-border/60 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Secured credentials</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Encrypted at rest · masked by default · never leaves this console.
                </p>
              </div>
              <Badge variant="outline" className="bg-success/15 text-success border-success/30">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success" />
                Vault healthy
              </Badge>
            </div>
            <div className="mt-6 space-y-3">
              {initialKeys.map((k) => (
                <KeyRow key={k.id} label={k.label} defaultValue={k.value} placeholder={k.placeholder} />
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="mt-4">
          <Card className="border-border/60 p-6">
            <h3 className="text-sm font-semibold tracking-tight">Export financial history</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Snapshot revenues, expenses, and investments for accounting.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              <ExportCard
                icon={FileSpreadsheet}
                title="Export to CSV"
                description="Full ledger export, importable in any spreadsheet or accounting tool."
                onClick={() => toast.success("CSV export queued — download will begin shortly")}
              />
              <ExportCard
                icon={FileText}
                title="Sync to Google Sheets"
                description="One-click sync to your finance workbook via Google Workspace API."
                onClick={() => toast.success("Google Sheets sync started")}
              />
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input defaultValue={defaultValue} />
    </div>
  );
}

function Checkline({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <span>{label}</span>
      {done ? (
        <Badge variant="outline" className="bg-success/15 text-success border-success/30">Done</Badge>
      ) : (
        <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Pending</Badge>
      )}
    </div>
  );
}

function KeyRow({ label, defaultValue, placeholder }: { label: string; defaultValue: string; placeholder: string }) {
  const [show, setShow] = useState(false);
  const [val, setVal] = useState(defaultValue);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          type={show ? "text" : "password"}
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            navigator.clipboard?.writeText(val);
            toast.success("Copied to clipboard");
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ExportCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: any;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/50"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

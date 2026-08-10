import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Building2,
  KeyRound,
  Download,
  Eye,
  EyeOff,
  Copy,
  FileSpreadsheet,
  FileText,
  Languages,
  Check,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLanguage, type AppLanguage } from "@/hooks/use-language";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const initialKeys = [
  {
    id: "openai",
    label: "OpenAI API Key",
    placeholder: "sk-proj-…",
    value: "sk-proj-9f2••••••••••••••••••••4c1a",
  },
  {
    id: "supabase",
    label: "Supabase Service Role",
    placeholder: "eyJhbGciOi…",
    value: "eyJhbGciOi••••••••••••••••7Q",
  },
  {
    id: "vapi",
    label: "Vapi API Key",
    placeholder: "vapi_live_…",
    value: "vapi_live_••••••••••••e8",
  },
  {
    id: "twilio",
    label: "Twilio Auth Token",
    placeholder: "AC-token",
    value: "AC••••••••••••••••••••••••••••••••",
  },
  {
    id: "retell",
    label: "Retell API Key",
    placeholder: "rk_live_…",
    value: "rk_live_••••••••••••••2f",
  },
];

function SettingsPage() {
  const { language, setLanguage, text } = useLanguage();
  const [savingLanguage, setSavingLanguage] = useState(false);

  const changeLanguage = async (nextLanguage: AppLanguage) => {
    if (nextLanguage === language || savingLanguage) return;
    setSavingLanguage(true);
    try {
      await setLanguage(nextLanguage);
      toast.success(
        nextLanguage === "es" ? "Idioma cambiado a español" : "Language changed to English",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : text("No se pudo guardar el idioma", "Language could not be saved"),
      );
    } finally {
      setSavingLanguage(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Owner Console</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {text("Configuración", "Settings")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {text(
            "Idioma, perfil de la empresa, credenciales y exportación de datos.",
            "Language, company profile, credentials, and data exports.",
          )}
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="general">
            <Languages className="mr-2 h-4 w-4" />
            {text("General", "General")}
          </TabsTrigger>
          <TabsTrigger value="profile">
            <Building2 className="mr-2 h-4 w-4" />
            {text("Perfil de empresa", "Company Profile")}
          </TabsTrigger>
          <TabsTrigger value="vault">
            <KeyRound className="mr-2 h-4 w-4" />
            {text("Credenciales", "Credentials Vault")}
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="mr-2 h-4 w-4" />
            {text("Exportar datos", "Export Data")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <Card className="border-border/60 p-6" style={{ background: "var(--gradient-card)" }}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <Languages className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight">
                  {text("Idioma de la aplicación", "Application language")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {text(
                    "Se aplica a toda la Owner Console y queda guardado en tu cuenta.",
                    "Applies to the entire Owner Console and is saved to your account.",
                  )}
                </p>
              </div>
            </div>
            <div className="mt-5 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
              <LanguageChoice
                active={language === "es"}
                title="Español"
                description="Español (República Dominicana)"
                disabled={savingLanguage}
                onClick={() => void changeLanguage("es")}
              />
              <LanguageChoice
                active={language === "en"}
                title="English"
                description="English (United States)"
                disabled={savingLanguage}
                onClick={() => void changeLanguage("en")}
              />
            </div>
          </Card>

          <Card className="border-border/60 p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-success/25 bg-success/10 text-success">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight">
                  {text("Proveedor de IA centralizado", "Centralized AI provider")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {text(
                    "Los bots usan el secreto central de Groq administrado en Fly. La clave nunca se copia al navegador ni se solicita durante la creación.",
                    "Bots use the central Groq secret managed in Fly. The key is never copied to the browser or requested during bot creation.",
                  )}
                </p>
                <Badge
                  variant="outline"
                  className="mt-3 border-success/30 bg-success/10 text-success"
                >
                  {text("Configuración recomendada", "Recommended configuration")}
                </Badge>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="mt-4">
          <Card className="border-border/60 p-6" style={{ background: "var(--gradient-card)" }}>
            <h3 className="text-sm font-semibold tracking-tight">
              {text("Datos de registro", "Registration details")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {text(
                "Seguimiento legal y registro de Wyoming.",
                "Wyoming filing tracker and legal identity.",
              )}
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={text("Nombre legal", "Legal Name")} defaultValue="Stage AI Labs LLC" />
              <Field
                label={text("Estado de constitución", "State of Formation")}
                defaultValue="Wyoming, USA"
              />
              <Field label="EIN" defaultValue="99-1234567" />
              <Field
                label={text("Agente registrado", "Registered Agent")}
                defaultValue="Cheyenne Registered Agents Inc."
              />
              <Field label={text("Fecha de registro", "Filing Date")} defaultValue="2026-01-08" />
              <Field
                label={text("Dirección principal", "Principal Address")}
                defaultValue="30 N Gould St Ste R, Sheridan, WY 82801"
              />
            </div>

            <div className="mt-6 border-t border-border/60 pt-4">
              <h4 className="text-sm font-medium">
                {text("Lista de cumplimiento", "Filing checklist")}
              </h4>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <Checkline
                  label={text(
                    "Artículos de organización presentados",
                    "Articles of Organization filed",
                  )}
                  done
                />
                <Checkline label={text("EIN emitido por el IRS", "EIN issued by IRS")} done />
                <Checkline
                  label={text("Acuerdo operativo firmado", "Operating Agreement signed")}
                  done
                />
                <Checkline
                  label={text("Agente registrado (anual)", "Registered agent (annual)")}
                  done
                />
                <Checkline label={text("Informe anual de Wyoming", "Wyoming annual report")} />
                <Checkline
                  label={text(
                    "Cuenta bancaria (Mercury / Relay)",
                    "Bank account (Mercury / Relay)",
                  )}
                  done
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="vault" className="mt-4">
          <Card className="border-border/60 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">
                  {text("Credenciales protegidas", "Secured credentials")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {text(
                    "Cifradas en reposo · ocultas por defecto · nunca salen de esta consola.",
                    "Encrypted at rest · masked by default · never leaves this console.",
                  )}
                </p>
              </div>
              <Badge variant="outline" className="bg-success/15 text-success border-success/30">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success" />
                {text("Bóveda operativa", "Vault healthy")}
              </Badge>
            </div>
            <div className="mt-6 space-y-3">
              {initialKeys.map((k) => (
                <KeyRow
                  key={k.id}
                  label={k.label}
                  defaultValue={k.value}
                  placeholder={k.placeholder}
                />
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="mt-4">
          <Card className="border-border/60 p-6">
            <h3 className="text-sm font-semibold tracking-tight">
              {text("Exportar historial financiero", "Export financial history")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {text(
                "Copia de ingresos, gastos e inversiones para contabilidad.",
                "Snapshot revenues, expenses, and investments for accounting.",
              )}
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              <ExportCard
                icon={FileSpreadsheet}
                title={text("Exportar a CSV", "Export to CSV")}
                description={text(
                  "Exportación completa del libro, compatible con hojas de cálculo y sistemas contables.",
                  "Full ledger export, importable in any spreadsheet or accounting tool.",
                )}
                onClick={() =>
                  toast.success(
                    text(
                      "Exportación CSV en cola; la descarga comenzará pronto",
                      "CSV export queued; download will begin shortly",
                    ),
                  )
                }
              />
              <ExportCard
                icon={FileText}
                title={text("Sincronizar con Google Sheets", "Sync to Google Sheets")}
                description={text(
                  "Sincronización con tu libro financiero mediante Google Workspace.",
                  "One-click sync to your finance workbook via Google Workspace API.",
                )}
                onClick={() =>
                  toast.success(
                    text("Sincronización con Google Sheets iniciada", "Google Sheets sync started"),
                  )
                }
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

function LanguageChoice({
  active,
  title,
  description,
  disabled,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
        active
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-muted/20 hover:border-primary/40"
      }`}
    >
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
      >
        {active ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
    </button>
  );
}

function Checkline({ label, done }: { label: string; done?: boolean }) {
  const { text } = useLanguage();
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <span>{label}</span>
      {done ? (
        <Badge variant="outline" className="bg-success/15 text-success border-success/30">
          {text("Listo", "Done")}
        </Badge>
      ) : (
        <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
          {text("Pendiente", "Pending")}
        </Badge>
      )}
    </div>
  );
}

function KeyRow({
  label,
  defaultValue,
  placeholder,
}: {
  label: string;
  defaultValue: string;
  placeholder: string;
}) {
  const { text } = useLanguage();
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
            toast.success(text("Copiado al portapapeles", "Copied to clipboard"));
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

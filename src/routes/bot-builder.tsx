import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  Loader2,
  MessageSquare,
  Mail,
  Mic,
  Rocket,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/bot-builder")({
  component: BotBuilder,
});

type BotType = "assistant" | "messaging" | "voice";

interface Client {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  services: string[] | null;
}

interface Product {
  id: string;
  name: string;
  category: string;
  status: string;
  monthly_cost: number;
}

interface CatalogItem {
  nombre: string;
  categoria: string;
  descripcion: string;
  precio: number;
}

interface BuildResult {
  slug: string;
  tenantPath: string;
  commitUrl: string | null;
  deployTriggered: boolean;
  botStatusUrl: string;
  dashboardUrl?: string;
  job?: ProvisionJob;
}

type BotBehavior = "sales" | "technical_support";

interface ProvisionJob {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  progress: number;
  phase: string;
  error: string | null;
  appName: string;
  clientId: string;
  slug: string;
  botStatusUrl: string;
  dashboardUrl: string;
  botId: string | null;
}

const botTypes: Record<
  BotType,
  {
    label: string;
    description: string;
    icon: typeof MessageSquare;
    productCategory: string;
  }
> = {
  messaging: {
    label: "Messaging bot",
    description: "WhatsApp sales and support automation.",
    icon: MessageSquare,
    productCategory: "messaging",
  },
  assistant: {
    label: "Assistant bot",
    description: "Asistente ejecutivo: tría el correo, redacta borradores y escala lo dudoso por WhatsApp.",
    icon: BrainCircuit,
    productCategory: "virtual_assistant",
  },
  voice: {
    label: "Voice bot",
    description: "Phone-style voice agent setup for future voice products.",
    icon: Mic,
    productCategory: "voice",
  },
};

const emptyCatalogItem: CatalogItem = {
  nombre: "",
  categoria: "General",
  descripcion: "",
  precio: 0,
};

const defaultDraft = {
  clientId: "",
  productId: "",
  botType: "messaging" as BotType,
  slug: "",
  nombreBot: "",
  descripcion: "",
  rubro: "",
  direccion: "Atencion por WhatsApp",
  horario: "Lunes a viernes de 9:00 AM a 6:00 PM",
  contacto: "",
  moneda: "USD",
  zonaHoraria: "America/Santo_Domingo",
  cotizaPorChat: true,
  behavior: "sales" as BotBehavior,
  companyInfo: "",
  extraPrompt: "",
  groqModel: "meta-llama/llama-4-scout-17b-16e-instruct",
  groqApiKey: "",
  updateClient: true,
  // --- Solo para bots tipo "assistant" -------------------------------------
  // El correo NO tiene valor por defecto a propósito: cada asistente atiende
  // la bandeja de SU ejecutivo y se pide aquí, al crear el bot.
  asistenteCorreo: "",
  asistenteWhatsapp: "",
  asistenteUmbral: 0.7,
  asistenteIntervalo: 10,
  asistenteHoraReporte: "18:00",
};

const botBehaviors: Record<BotBehavior, { label: string; description: string; icon: typeof Bot }> = {
  sales: {
    label: "Ventas, agendamiento y fidelización",
    description: "Capta clientes, coordina reservas y fortalece la relación post-venta.",
    icon: Bot,
  },
  technical_support: {
    label: "Soporte técnico especializado",
    description: "Diagnostica, guía paso a paso y escala casos complejos sin vender.",
    icon: BrainCircuit,
  },
};

const groqModels = [
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout — recommended" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — strong reasoning" },
  { id: "qwen/qwen3-32b", label: "Qwen 3 32B — balanced" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B — fastest" },
];

function BotBuilder() {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [catalog, setCatalog] = useState<CatalogItem[]>([{ ...emptyCatalogItem }]);
  const [result, setResult] = useState<BuildResult | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [clientsRes, productsRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id,company_name,contact_name,email,phone,services")
          .order("company_name"),
        supabase
          .from("products")
          .select("id,name,category,status,monthly_cost")
          .order("name"),
      ]);
      if (clientsRes.error) toast.error(clientsRes.error.message);
      else setClients((clientsRes.data ?? []) as Client[]);
      if (productsRes.error) toast.error(productsRes.error.message);
      else setProducts((productsRes.data ?? []) as Product[]);
      setLoading(false);
    };
    void load();
  }, []);

  useEffect(() => {
    const jobId = result?.job?.id;
    const jobState = result?.job?.state;
    if (!jobId || jobState === "complete" || jobState === "failed") return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        const response = await fetch(`/api/provision-status?jobId=${encodeURIComponent(jobId)}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "No se pudo leer el provisioning.");
        if (!cancelled) {
          setResult((current) => current ? { ...current, job: body.job as ProvisionJob, botStatusUrl: body.job.botStatusUrl } : current);
          if (body.job.state === "complete") toast.success("Bot desplegado. Ya puedes abrir el QR desde Client Manager.");
          if (body.job.state === "failed") toast.error(body.job.error ?? "El provisioning falló.");
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "No se pudo leer el provisioning.");
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [result?.job?.id, result?.job?.state]);

  const selectedClient = clients.find((client) => client.id === draft.clientId);
  const selectedProduct = products.find((product) => product.id === draft.productId);

  const compatibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.status === "active" &&
          product.category === botTypes[draft.botType].productCategory,
      ),
    [products, draft.botType],
  );

  // The bot type is the source of truth.  Keep the matching active product
  // assigned automatically, including on the initial Messaging selection.
  useEffect(() => {
    const automaticProduct = compatibleProducts[0];
    setDraft((current) =>
      current.productId === (automaticProduct?.id ?? "")
        ? current
        : { ...current, productId: automaticProduct?.id ?? "" },
    );
  }, [compatibleProducts]);

  const slug = draft.slug || slugify(selectedClient?.company_name ?? "");
  const selectClient = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    setDraft((current) => ({
      ...current,
      clientId,
      slug: slugify(client?.company_name ?? ""),
      nombreBot: client ? `${client.company_name} Bot` : current.nombreBot,
      contacto: client?.phone ?? current.contacto,
    }));
  };

  const selectBotType = (botType: BotType) => {
    const category = botTypes[botType].productCategory;
    const nextProduct = products.find(
      (product) => product.status === "active" && product.category === category,
    );
    setDraft((current) => ({
      ...current,
      botType,
      productId: nextProduct?.id ?? "",
    }));
  };

  const updateCatalog = (index: number, patch: Partial<CatalogItem>) => {
    setCatalog((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const addCatalogItem = () => {
    setCatalog((items) => [...items, { ...emptyCatalogItem }]);
  };

  const removeCatalogItem = (index: number) => {
    setCatalog((items) => items.filter((_, itemIndex) => itemIndex !== index));
  };

  const commitBot = async () => {
    if (!selectedClient) return toast.error("Choose an existing client first.");
    if (!selectedProduct) return toast.error("Choose the product this bot belongs to.");
    if (!slug) return toast.error("The bot needs a valid slug.");
    // Un asistente sin correo no tiene bandeja que triar: se pide aquí y no
    // se completa nunca a mano en el repositorio.
    if (draft.botType === "assistant") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.asistenteCorreo.trim())) {
        return toast.error("Indica el correo que este asistente va a atender.");
      }
      if (draft.asistenteWhatsapp.replace(/\D/g, "").length < 8) {
        return toast.error("Indica el WhatsApp (con código de país) donde el ejecutivo recibirá las alertas.");
      }
    }
    setSaving(true);
    setResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const res = await fetch("/api/bot-builder", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: selectedClient.id,
          productName: selectedProduct.name,
          botType: draft.botType,
          tenant: {
            slug,
            nombreBot: draft.nombreBot || `${selectedClient.company_name} Bot`,
            nombre: selectedClient.company_name,
            descripcion: draft.descripcion,
            direccion: draft.direccion,
            horario: draft.horario,
            contacto: draft.contacto || selectedClient.phone || "",
            moneda: draft.moneda,
            zonaHoraria: draft.zonaHoraria,
            servicios: draft.behavior === "sales" ? catalog.map((item) => item.nombre).filter(Boolean) : [],
            behavior: draft.behavior,
            companyInfo: draft.companyInfo,
            extraInstructions: draft.extraPrompt,
            googleCalendarId: "primary",
            asistente:
              draft.botType === "assistant"
                ? {
                    correo: draft.asistenteCorreo.trim().toLowerCase(),
                    whatsappAlertas: draft.asistenteWhatsapp.replace(/\D/g, ""),
                    umbralConfianza: draft.asistenteUmbral,
                    intervaloMinutos: draft.asistenteIntervalo,
                    horaReporte: draft.asistenteHoraReporte,
                  }
                : undefined,
          },
          groqModel: draft.groqModel,
          groqApiKey: draft.groqApiKey || undefined,
          updateClient: draft.updateClient,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "The bot could not be created.");
      setResult(body as BuildResult);
      toast.success("Provisioning iniciado. Puedes seguir usando el Owner Console.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The bot could not be created.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Bot Factory
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            Create Client Bot
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Elige el cliente, tipo y comportamiento. Owner Console crea la app dedicada, configura la IA,
            guarda el tenant en GitHub y prepara el dashboard y QR de WhatsApp.
          </p>
        </div>
        <Button variant="outline" className="gap-2" disabled={saving || loading} onClick={commitBot}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Create and deploy bot
        </Button>
      </div>

      <div className="space-y-4">
          <Card className="border-border/60 p-5">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">1. Cliente y tipo de bot</h3>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Cliente existente</Label>
                <Select value={draft.clientId} onValueChange={selectClient}>
                  <SelectTrigger>
                    <SelectValue placeholder={loading ? "Cargando clientes..." : "Elegir cliente"} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Producto asignado automáticamente</Label>
                <div className="flex min-h-10 items-center rounded-md border border-input bg-muted/30 px-3 text-sm">
                  {selectedProduct
                    ? selectedProduct.name
                    : `No hay un producto activo para ${botTypes[draft.botType].label}.`}
                </div>
                <p className="text-xs text-muted-foreground">Se asigna automáticamente al elegir el tipo de bot.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(Object.keys(botTypes) as BotType[]).map((type) => {
                const Icon = botTypes[type].icon;
                const active = draft.botType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => selectBotType(type)}
                    className={
                      "rounded-lg border p-4 text-left transition-colors " +
                      (active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground")
                    }
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{botTypes[type].label}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5">{botTypes[type].description}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="border-border/60 p-5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">2. Comportamiento del bot</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Se aplica internamente al prompt del bot y puede complementarse con información de la empresa.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(Object.keys(botBehaviors) as BotBehavior[]).map((behavior) => {
                const Icon = botBehaviors[behavior].icon;
                const active = draft.behavior === behavior;
                return (
                  <button
                    key={behavior}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, behavior }))}
                    className={"rounded-lg border p-4 text-left transition-colors " + (active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground")}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{botBehaviors[behavior].label}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5">{botBehaviors[behavior].description}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          {draft.botType === "assistant" && (
            <Card className="border-primary/40 bg-primary/5 p-5">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Bandeja que va a atender</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                El asistente revisa este correo, descarta lo automatizado, clasifica el resto y deja
                borradores listos. Lo que no entienda con seguridad se escala por WhatsApp en vez de
                responderse solo. El ejecutivo autoriza su cuenta con un clic desde su dashboard.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Correo a asistir">
                  <Input
                    type="email"
                    value={draft.asistenteCorreo}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, asistenteCorreo: event.target.value }))
                    }
                    placeholder="director@empresa.com"
                  />
                </Field>
                <Field label="WhatsApp para alertas">
                  <Input
                    value={draft.asistenteWhatsapp}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, asistenteWhatsapp: event.target.value }))
                    }
                    placeholder="18091234567"
                  />
                </Field>
                <Field label={`Umbral de confianza — ${Math.round(draft.asistenteUmbral * 100)}%`}>
                  <Input
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.05}
                    value={draft.asistenteUmbral}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, asistenteUmbral: Number(event.target.value) }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Más alto = el asistente consulta más y redacta menos por su cuenta.
                  </p>
                </Field>
                <Field label="Revisar la bandeja cada">
                  <Select
                    value={String(draft.asistenteIntervalo)}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, asistenteIntervalo: Number(value) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 minutos</SelectItem>
                      <SelectItem value="10">10 minutos — recomendado</SelectItem>
                      <SelectItem value="15">15 minutos</SelectItem>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="60">1 hora</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Hora del reporte de fin de día">
                  <Input
                    type="time"
                    value={draft.asistenteHoraReporte}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, asistenteHoraReporte: event.target.value }))
                    }
                  />
                </Field>
              </div>
            </Card>
          )}

          <Card className="border-border/60 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">3. Información del bot</h3>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Slug">
                <Input
                  value={slug}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))
                  }
                  placeholder="cliente-demo"
                />
              </Field>
              <Field label="Bot name">
                <Input
                  value={draft.nombreBot}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, nombreBot: event.target.value }))
                  }
                  placeholder="Acme Bot"
                />
              </Field>
              <Field label="Business type">
                <Input
                  value={draft.rubro}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rubro: event.target.value }))
                  }
                  placeholder="Auto body shop, dental clinic, real estate..."
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={draft.moneda}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, moneda: event.target.value }))
                  }
                  placeholder="USD"
                />
              </Field>
              <Field label="Hours">
                <Input
                  value={draft.horario}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, horario: event.target.value }))
                  }
                />
              </Field>
              <Field label="Timezone">
                <Input
                  value={draft.zonaHoraria}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, zonaHoraria: event.target.value }))
                  }
                />
              </Field>
              <Field label="Address">
                <Input
                  value={draft.direccion}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, direccion: event.target.value }))
                  }
                />
              </Field>
              <Field label="Contact">
                <Input
                  value={draft.contacto}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, contacto: event.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <div>
                  <Label>Can quote by chat</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Turn off for businesses that quote only after inspection.
                  </p>
                </div>
                <Switch
                  checked={draft.cotizaPorChat}
                  onCheckedChange={(cotizaPorChat) =>
                    setDraft((current) => ({ ...current, cotizaPorChat }))
                  }
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label>Información de la empresa</Label>
              <Textarea
                rows={5}
                value={draft.companyInfo}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, companyInfo: event.target.value }))
                }
                placeholder="Describe a qué se dedica la empresa, sus servicios, políticas, garantías, procesos y cualquier información útil para atender correctamente."
              />
            </div>
            <div className="mt-4 space-y-2">
              <Label>Extra instructions</Label>
              <Textarea
                rows={4}
                value={draft.extraPrompt}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, extraPrompt: event.target.value }))
                }
                placeholder="Reglas adicionales específicas para este cliente."
              />
            </div>
            <div className="mt-4 grid gap-4 rounded-lg border border-border/60 p-4 md:grid-cols-2">
              <Field label="Groq model">
                <Select
                  value={draft.groqModel}
                  onValueChange={(groqModel) => setDraft((current) => ({ ...current, groqModel }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {groqModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Groq API key override (optional)">
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.groqApiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, groqApiKey: event.target.value }))}
                  placeholder="Uses the local default when left empty"
                />
              </Field>
              <p className="text-xs text-muted-foreground md:col-span-2">
                The selected model and key are configured only inside this client&apos;s Fly app. Groq keys must be created manually in Groq Console.
              </p>
            </div>
          </Card>

          {draft.behavior === "sales" && <Card className="border-border/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">4. Catálogo inicial</h3>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addCatalogItem}>
                Add service
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {catalog.map((item, index) => (
                <div key={index} className="grid gap-3 rounded-lg border border-border/60 p-3 md:grid-cols-[1fr_130px_1fr_90px_40px]">
                  <Input
                    value={item.nombre}
                    onChange={(event) => updateCatalog(index, { nombre: event.target.value })}
                    placeholder="Service name"
                  />
                  <Input
                    value={item.categoria}
                    onChange={(event) => updateCatalog(index, { categoria: event.target.value })}
                    placeholder="Category"
                  />
                  <Input
                    value={item.descripcion}
                    onChange={(event) => updateCatalog(index, { descripcion: event.target.value })}
                    placeholder="Description"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={item.precio}
                    onChange={(event) => updateCatalog(index, { precio: Number(event.target.value) })}
                    placeholder="Price"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={catalog.length === 1}
                    onClick={() => removeCatalogItem(index)}
                  >
                    x
                  </Button>
                </div>
              ))}
            </div>
          </Card>}

          <Card className="border-border/60 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{draft.behavior === "sales" ? "5." : "4."} Opciones de automatización</h3>
            </div>
            <div className="mt-4 grid gap-3">
              <ToggleRow
                label="Update client record"
                description="Links the bot, local dashboard URL, and product to Client Manager."
                checked={draft.updateClient}
                onChange={(updateClient) => setDraft((current) => ({ ...current, updateClient }))}
              />
            </div>
          </Card>

        {result && (
            <Card className="border-success/40 bg-success/5 p-5">
              <div className="flex items-center gap-2 text-success">
                <Check className="h-4 w-4" />
                <h3 className="text-sm font-semibold">
                  {result.job?.state === "complete" ? "Bot desplegado" : "Desplegando bot"}
                </h3>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                {result.job && (
                  <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium">{result.job.phase}</span>
                      <span className="text-muted-foreground">{result.job.progress}%</span>
                    </div>
                    <Progress className="mt-3 h-2" value={result.job.progress} />
                    <p className="mt-2 text-xs text-muted-foreground">Fly app: {result.job.appName}</p>
                    {result.job.error && <p className="mt-2 text-xs text-destructive">{result.job.error}</p>}
                  </div>
                )}
                <ResultLine label="Tenant file" value={result.tenantPath} />
                <ResultLine label="Bot URL" value={result.botStatusUrl} />
                {result.job?.state === "complete" && (
                  <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                    Falta crear el usuario del cliente en Client Manager → Access → Administrar usuarios, y luego conectar WhatsApp desde el QR.
                  </p>
                )}
                {result.dashboardUrl && (
                  <a
                    href={result.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-border/60 px-3 py-2 text-center text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open client dashboard
                  </a>
                )}
                {result.commitUrl && (
                  <a
                    href={result.commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-primary underline-offset-4 hover:underline"
                  >
                    Open GitHub commit
                  </a>
                )}
              </div>
            </Card>
          )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs">{value}</p>
    </div>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

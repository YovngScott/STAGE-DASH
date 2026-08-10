import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  UserRound,
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

interface BuildResult {
  draft?: boolean;
  qualityUrl?: string;
  slug: string;
  tenantPath: string;
  commitUrl: string | null;
  deployTriggered: boolean;
  botStatusUrl: string;
  dashboardUrl?: string;
  job?: ProvisionJob;
}

type BotBehavior = "sales" | "technical_support" | "personal_assistant";

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
  microsoftRedirectUri: string | null;
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
    description:
      "Asistente ejecutivo: tría el correo, redacta borradores y escala lo dudoso por WhatsApp.",
    icon: BrainCircuit,
    productCategory: "virtual_assistant",
  },
  voice: {
    label: "Voice bot · En desarrollo",
    description:
      "No se publica todavía: primero completaremos llamadas, pruebas y controles de seguridad.",
    icon: Mic,
    productCategory: "voice",
  },
};

const defaultDraft = {
  clientId: "",
  productId: "",
  botType: "messaging" as BotType,
  slug: "",
  nombreBot: "",
  descripcion: "",
  direccion: "Atencion por WhatsApp",
  horario: "Lunes a viernes de 9:00 AM a 6:00 PM",
  contacto: "",
  moneda: "USD",
  zonaHoraria: "America/Santo_Domingo",
  cotizaPorChat: true,
  behavior: "sales" as BotBehavior,
  companyInfo: "",
  extraPrompt: "",
  groqModel: "llama-3.3-70b-versatile",
  groqApiKey: "",
  updateClient: true,
  // --- Solo para bots tipo "assistant" -------------------------------------
  // El correo NO tiene valor por defecto a propósito: cada asistente atiende
  // la bandeja de SU ejecutivo y se pide aquí, al crear el bot.
  asistenteCorreo: "",
  asistenteWhatsapp: "",
  asistenteUmbral: 0.35,
  asistenteIntervalo: 10,
  asistenteHoraReporte: "18:00",
  // Apagado por defecto: escribir a nombre del titular es una decisión
  // consciente del cliente, no algo que ocurra sin que nadie lo pida.
  asistenteActuaComoTitular: false,
  asistenteNombreTitular: "",
  // APAGADO por defecto, a propósito. Un asistente recién creado nunca ha
  // sido calibrado: sus primeras respuestas salen a nombre del cliente y un
  // correo enviado no se puede retirar. Que el cliente lea unos cuantos
  // borradores y lo encienda cuando le convenza.
  asistenteEnviarAutomatico: false,
  asistenteProveedor: "gmail" as ProveedorCorreo,
};

type ProveedorCorreo = "gmail" | "microsoft" | "imap";

/**
 * Proveedores de correo que puede atender el asistente. La elección solo
 * cambia cómo se conecta la cuenta: el triaje, los borradores y el envío
 * funcionan idénticos con los tres.
 */
const proveedoresCorreo: Record<
  ProveedorCorreo,
  { label: string; description: string; comoConecta: string }
> = {
  gmail: {
    label: "Gmail / Google Workspace",
    description: "Cuentas @gmail.com y dominios en Google Workspace.",
    comoConecta: "El ejecutivo autoriza con un clic desde su dashboard.",
  },
  microsoft: {
    label: "Microsoft / Outlook",
    description: "Outlook.com, Hotmail, Live y Microsoft 365 corporativo.",
    comoConecta: "El ejecutivo autoriza con un clic desde su dashboard.",
  },
  imap: {
    label: "Correo corporativo (IMAP)",
    description: "Cualquier dominio propio con IMAP y SMTP.",
    comoConecta:
      "El ejecutivo carga los datos de su servidor desde su dashboard; la contraseña se guarda cifrada.",
  },
};

const botBehaviors: Record<BotBehavior, { label: string; description: string; icon: typeof Bot }> =
  {
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
    personal_assistant: {
      label: "Personal assistant",
      description:
        "Le quita carga administrativa al ejecutivo: tría su correo, deja borradores listos y solo lo interrumpe con lo que amerita su criterio.",
      icon: UserRound,
    },
  };

/**
 * Qué campos de "Información del bot" tienen sentido en cada comportamiento.
 * Un asistente personal no vende ni atiende en un local, así que pedirle
 * moneda, rubro o dirección solo ensucia el formulario.
 */
type CampoInfo = "moneda" | "horario" | "direccion" | "contacto" | "cotizaPorChat";

const camposPorComportamiento: Record<BotBehavior, CampoInfo[]> = {
  sales: ["moneda", "horario", "direccion", "contacto", "cotizaPorChat"],
  // Soporte no cotiza ni cobra: moneda y "cotiza por chat" no aplican.
  technical_support: ["horario", "direccion", "contacto"],
  // El asistente trabaja para UNA persona; su zona horaria es lo único que
  // necesita del contexto físico (para agendar y para el reporte del día).
  personal_assistant: [],
};

/** El bloque de contexto libre cambia de sentido según a quién sirve el bot. */
const contextoPorComportamiento: Record<BotBehavior, { label: string; placeholder: string }> = {
  sales: {
    label: "Información de la empresa",
    placeholder:
      "Describe a qué se dedica la empresa, sus servicios, políticas, garantías, procesos y cualquier información útil para atender correctamente.",
  },
  technical_support: {
    label: "Información de la empresa",
    placeholder:
      "Describe los productos que soporta, fallas frecuentes, políticas de garantía y devolución, y los pasos de diagnóstico habituales.",
  },
  personal_assistant: {
    label: "Contexto del ejecutivo",
    placeholder:
      "¿A quién asiste y a qué se dedica? Qué asuntos son prioritarios para él, con qué remitentes o temas debe tener especial cuidado, y qué puede resolver sin consultarle.",
  },
};

/**
 * Modelos verificados contra la API de Groq. Ojo al editar esta lista: un id
 * que no exista NO falla al crear el bot — falla en silencio después, cuando
 * el bot intenta responder y Groq devuelve 404. Confirma cualquier id nuevo
 * contra https://api.groq.com/openai/v1/models antes de agregarlo.
 */
function BotBuilder() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [result, setResult] = useState<BuildResult | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [clientsRes, productsRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id,company_name,contact_name,email,phone,services")
          .order("company_name"),
        supabase.from("products").select("id,name,category,status,monthly_cost").order("name"),
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
        const response = await fetch(
          `/api/provision-status?jobId=${encodeURIComponent(jobId)}&slug=${encodeURIComponent(result?.slug ?? "")}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "No se pudo leer el provisioning.");
        if (!cancelled) {
          setResult((current) =>
            current
              ? { ...current, job: body.job as ProvisionJob, botStatusUrl: body.job.botStatusUrl }
              : current,
          );
          if (body.job.state === "complete")
            toast.success("Bot desplegado. Ya puedes abrir el QR desde Client Manager.");
          if (body.job.state === "failed") toast.error(body.job.error ?? "El provisioning falló.");
        }
      } catch (error) {
        if (!cancelled)
          toast.error(error instanceof Error ? error.message : "No se pudo leer el provisioning.");
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [result?.job?.id, result?.job?.state, result?.slug]);

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
  const muestra = (campo: CampoInfo) => camposPorComportamiento[draft.behavior].includes(campo);
  const contexto = contextoPorComportamiento[draft.behavior];
  const availableBehaviors: BotBehavior[] =
    draft.botType === "assistant" ? ["personal_assistant"] : ["sales", "technical_support"];
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
      // El comportamiento acompaña al tipo: un Assistant bot nace como
      // asistente personal, y volver a los otros tipos recupera ventas (un bot
      // de WhatsApp de cara al cliente no tiene sentido como asistente personal).
      behavior:
        botType === "assistant"
          ? "personal_assistant"
          : current.behavior === "personal_assistant"
            ? "sales"
            : current.behavior,
    }));
  };

  const commitBot = async () => {
    if (!selectedClient) return toast.error("Choose an existing client first.");
    if (!slug) return toast.error("The bot needs a valid slug.");
    // Un asistente sin correo no tiene bandeja que triar: se pide aquí y no
    // se completa nunca a mano en el repositorio.
    if (draft.botType === "assistant") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.asistenteCorreo.trim())) {
        return toast.error("Indica el correo que este asistente va a atender.");
      }
      if (draft.asistenteWhatsapp.replace(/\D/g, "").length < 8) {
        return toast.error(
          "Indica el WhatsApp (con código de país) donde el ejecutivo recibirá las alertas.",
        );
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
          // Opcional a propósito: si existe un producto activo de esa categoría
          // se vincula para el ledger, pero su ausencia no debe impedir crear
          // el bot — es contabilidad interna, no configuración del bot.
          productName: selectedProduct?.name ?? null,
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
            // El catálogo ya no se captura aquí: el cliente lo carga desde su
            // propio dashboard (pestaña Archivos), que es donde puede mantenerlo.
            servicios: [],
            behavior: draft.behavior,
            companyInfo: draft.companyInfo,
            extraInstructions: draft.extraPrompt,
            cotizaPorChat: draft.cotizaPorChat,
            googleCalendarId: "primary",
            asistente:
              draft.botType === "assistant"
                ? {
                    correo: draft.asistenteCorreo.trim().toLowerCase(),
                    whatsappAlertas: draft.asistenteWhatsapp.replace(/\D/g, ""),
                    umbralConfianza: draft.asistenteUmbral,
                    intervaloMinutos: draft.asistenteIntervalo,
                    horaReporte: draft.asistenteHoraReporte,
                    actuaComoTitular: draft.asistenteActuaComoTitular,
                    nombreTitular:
                      draft.asistenteNombreTitular.trim() || selectedClient.company_name,
                    enviarAutomatico: draft.asistenteEnviarAutomatico,
                    proveedor: draft.asistenteProveedor,
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
      if (body?.draft && body?.slug) {
        toast.success("Borrador guardado. Vamos a probarlo antes de publicar.");
        await navigate({ to: "/quality-center", search: { slug: body.slug } as never });
        return;
      }
      setResult(body as BuildResult);
      toast.success("Publicación iniciada.");
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
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Bot Factory</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Create Client Bot</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Elige la función y añade únicamente la información del negocio. Las políticas seguras se
            aplican en el backend; primero se prueba en borrador y no se crea ninguna máquina hasta
            que tú lo apruebes.
          </p>
        </div>
        <Button className="gap-2" disabled={saving || loading} onClick={commitBot}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Guardar y probar bot
        </Button>
      </div>

      <div className="space-y-4">
        <Card className="border-border/60 p-5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">1. Cliente y tipo de bot</h3>
          </div>
          <div className="mt-4">
            <div className="space-y-2 md:max-w-md">
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
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(Object.keys(botTypes) as BotType[]).map((type) => {
              const Icon = botTypes[type].icon;
              const active = draft.botType === type;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={type === "voice"}
                  onClick={() => selectBotType(type)}
                  className={
                    "rounded-lg border p-4 text-left transition-colors " +
                    (type === "voice"
                      ? "cursor-not-allowed border-border/40 bg-muted/20 text-muted-foreground opacity-60"
                      : active
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
            <h3 className="text-sm font-semibold">2. Función del bot</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada función incluye comportamiento, límites, herramientas autorizadas y reglas de
            escalamiento predeterminadas.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {availableBehaviors.map((behavior) => {
              const Icon = botBehaviors[behavior].icon;
              const active = draft.behavior === behavior;
              return (
                <button
                  key={behavior}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, behavior }))}
                  className={
                    "rounded-lg border p-4 text-left transition-colors " +
                    (active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground")
                  }
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
          <div className="mt-4 rounded-lg border border-success/20 bg-success/5 p-3 text-xs text-muted-foreground">
            Incluido automáticamente: protección del prompt y datos privados, bloqueo fuera del
            negocio, precios solo desde catálogo, acciones delicadas con aprobación humana y
            validación de herramientas.
          </div>
        </Card>

        {draft.botType === "assistant" && (
          <Card className="border-primary/40 bg-primary/5 p-5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">3. Correo y operación</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              El asistente revisa este correo, descarta lo automatizado (no-reply, boletines, correo
              masivo) y responde el resto por su cuenta. Lo que debe decidir el titular en persona
              —temas legales, dinero comprometido, seguridad o conflictos delicados— nunca se envía:
              le deja el borrador escrito y le avisa por WhatsApp para que solo revise y mande. El
              ejecutivo autoriza su cuenta con un clic desde su dashboard.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(Object.keys(proveedoresCorreo) as ProveedorCorreo[]).map((p) => {
                const activo = draft.asistenteProveedor === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, asistenteProveedor: p }))}
                    className={
                      "rounded-lg border p-3 text-left transition-colors " +
                      (activo
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground")
                    }
                  >
                    <span className="text-sm font-medium">{proveedoresCorreo[p].label}</span>
                    <p className="mt-1 text-xs leading-5">{proveedoresCorreo[p].description}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {proveedoresCorreo[draft.asistenteProveedor].comoConecta}
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
              <Field
                label={`Exigencia para redactar — ${Math.round(draft.asistenteUmbral * 100)}%`}
              >
                <Input
                  type="range"
                  min={0.2}
                  max={0.8}
                  step={0.05}
                  value={draft.asistenteUmbral}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      asistenteUmbral: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Red de seguridad del envío automático: si no entendió el correo por encima de este
                  nivel, no lo envía — lo deja como borrador para que lo revise el titular. Súbelo
                  si notas que se envían respuestas flojas; bájalo si escala de más.
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
                    setDraft((current) => ({
                      ...current,
                      asistenteHoraReporte: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Enviar solo los correos rutinarios</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Activado: responde y envía por su cuenta lo rutinario (consultas simples,
                    acuses, agradecimientos, seguimiento), y esos correos salen de la bandeja sin
                    que el titular los toque. Lo delicado y lo que no entienda nunca se envía: queda
                    como borrador con aviso. Desactivado: no envía nada, todo queda en borradores.
                  </p>
                  <p className="mt-2 text-xs text-amber-500/90">
                    Recomendado dejarlo apagado al empezar: que el cliente revise unos días de
                    borradores y lo encienda cuando la calidad le convenza. Un correo enviado a su
                    nombre no se puede retirar.
                  </p>
                </div>
                <Switch
                  checked={draft.asistenteEnviarAutomatico}
                  onCheckedChange={(asistenteEnviarAutomatico) =>
                    setDraft((current) => ({ ...current, asistenteEnviarAutomatico }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Escribir con el nombre del titular</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Activado: redacta en primera persona como el titular, sin mencionar que hay un
                    asistente. Desactivado: se presenta como asistente que escribe en su nombre.
                  </p>
                </div>
                <Switch
                  checked={draft.asistenteActuaComoTitular}
                  onCheckedChange={(asistenteActuaComoTitular) =>
                    setDraft((current) => ({ ...current, asistenteActuaComoTitular }))
                  }
                />
              </div>

              {draft.asistenteActuaComoTitular && (
                <div className="mt-3 space-y-2">
                  <Field label="Nombre con el que firma">
                    <Input
                      value={draft.asistenteNombreTitular}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          asistenteNombreTitular: event.target.value,
                        }))
                      }
                      placeholder={
                        selectedClient?.company_name ?? "Nombre del titular o de la empresa"
                      }
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Con el envío automático activo, estos correos salen a nombre del titular sin que
                    él los lea antes. Lo delicado sigue quedando como borrador para su revisión.
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card className="border-border/60 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {draft.botType === "assistant" ? "4" : "3"}. Información y personalización
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            La identidad técnica, URL, modelo y vínculo con el cliente se generan automáticamente.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {muestra("moneda") && (
              <Field label="Currency">
                <Input
                  value={draft.moneda}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, moneda: event.target.value }))
                  }
                  placeholder="USD"
                />
              </Field>
            )}
            {muestra("horario") && (
              <Field label="Hours">
                <Input
                  value={draft.horario}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, horario: event.target.value }))
                  }
                />
              </Field>
            )}
            {/* La zona horaria aplica a todos: agenda, recordatorios y la hora
                  del reporte diario dependen de ella. */}
            <Field label="Timezone">
              <Input
                value={draft.zonaHoraria}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, zonaHoraria: event.target.value }))
                }
              />
            </Field>
            {muestra("direccion") && (
              <Field label="Address">
                <Input
                  value={draft.direccion}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, direccion: event.target.value }))
                  }
                />
              </Field>
            )}
            {muestra("contacto") && (
              <Field label="Contact">
                <Input
                  value={draft.contacto}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, contacto: event.target.value }))
                  }
                />
              </Field>
            )}
          </div>
          {muestra("cotizaPorChat") && (
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
          )}
          <div className="mt-4 space-y-2">
            <Label>{contexto.label}</Label>
            <Textarea
              rows={5}
              value={draft.companyInfo}
              onChange={(event) =>
                setDraft((current) => ({ ...current, companyInfo: event.target.value }))
              }
              placeholder={contexto.placeholder}
            />
          </div>
          <div className="mt-4 space-y-2">
            <Label>Personalización: restricciones y comportamiento</Label>
            <Textarea
              rows={4}
              value={draft.extraPrompt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, extraPrompt: event.target.value }))
              }
              placeholder="Ej.: qué debe escalar, tono preferido, excepciones autorizadas y límites particulares. Las reglas de seguridad base no se pueden eliminar."
            />
            <p className="text-xs text-muted-foreground">
              Este campo complementa la función predeterminada; no sustituye las políticas internas
              de seguridad.
            </p>
          </div>
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            Siguiente paso: se guarda un borrador y se abre el Centro de Calidad. Allí probarás
            respuestas, decisiones, herramientas e infraestructura antes de habilitar “Crear y
            publicar bot”.
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    Fly app: {result.job.appName}
                  </p>
                  {result.job.error && (
                    <p className="mt-2 text-xs text-destructive">{result.job.error}</p>
                  )}
                </div>
              )}
              <ResultLine label="Tenant file" value={result.tenantPath} />
              <ResultLine label="Bot URL" value={result.botStatusUrl} />
              {result.job?.state === "complete" && (
                <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
                  Falta crear el usuario del cliente en Client Manager → Access → Administrar
                  usuarios, y luego conectar WhatsApp desde el QR.
                </p>
              )}
              {result.job?.microsoftRedirectUri && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                  <p className="font-medium text-foreground">
                    Antes de que el cliente conecte Outlook: registra este URI en Entra ID
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Azure → App registrations → Stage AI Labs Asistente → Authentication → Add URI.
                    Lleva el nombre de la app de este cliente, así que es distinto para cada uno.
                  </p>
                  <code className="mt-2 block break-all rounded bg-background/60 p-2 text-[11px] text-foreground">
                    {result.job.microsoftRedirectUri}
                  </code>
                </div>
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

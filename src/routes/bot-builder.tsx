import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  Rocket,
  Sparkles,
  Terminal,
  UserRound,
  XCircle,
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
import { useLanguage } from "@/hooks/use-language";

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
  logs?: string[];
}

const botTypes: Record<
  BotType,
  {
    label: readonly [string, string];
    description: readonly [string, string];
    icon: typeof MessageSquare;
    productCategory: string;
  }
> = {
  messaging: {
    label: ["Bot de mensajería", "Messaging bot"],
    description: [
      "Automatización de ventas y soporte por WhatsApp.",
      "WhatsApp sales and support automation.",
    ],
    icon: MessageSquare,
    productCategory: "messaging",
  },
  assistant: {
    label: ["Bot asistente", "Assistant bot"],
    description: [
      "Asistente ejecutivo: tría el correo, redacta borradores y escala lo dudoso por WhatsApp.",
      "Executive assistant: triages email, drafts replies, and escalates uncertain cases through WhatsApp.",
    ],
    icon: BrainCircuit,
    productCategory: "virtual_assistant",
  },
  voice: {
    label: ["Bot de voz (Vapi / Retell)", "Voice bot (Vapi / Retell)"],
    description: [
      "Asistente telefónico en vivo: atiende llamadas, consulta precios y agenda en Google Calendar.",
      "Live phone assistant: handles calls, checks prices, and books in Google Calendar.",
    ],
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
  direccion: "Atención por WhatsApp",
  horario: "Lunes a viernes de 9:00 AM a 6:00 PM",
  contacto: "",
  moneda: "USD",
  zonaHoraria: "America/Santo_Domingo",
  businessDays: [1, 2, 3, 4, 5] as number[],
  businessStart: "09:00",
  businessEnd: "18:00",
  quietStart: "20:00",
  quietEnd: "08:00",
  holidays: [] as string[],
  appointmentReminderTime: "09:00",
  dailyReportTime: "20:00",
  cotizaPorChat: true,
  behavior: "sales" as BotBehavior,
  companyInfo: "",
  extraPrompt: "",
  groqModel: "openai/gpt-oss-120b",
  groqKeyMode: "automatic" as "automatic" | "dedicated",
  groqApiKey: "",
  whatsappProvider: "baileys" as "baileys" | "meta_cloud",
  metaPhoneNumberId: "",
  metaBusinessAccountId: "",
  metaApiVersion: "v23.0",
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

const scheduleDays = [
  { value: 1, label: ["Lun", "Mon"] as const },
  { value: 2, label: ["Mar", "Tue"] as const },
  { value: 3, label: ["Mié", "Wed"] as const },
  { value: 4, label: ["Jue", "Thu"] as const },
  { value: 5, label: ["Vie", "Fri"] as const },
  { value: 6, label: ["Sáb", "Sat"] as const },
  { value: 0, label: ["Dom", "Sun"] as const },
];

type ProveedorCorreo = "gmail" | "microsoft" | "imap";

/**
 * Proveedores de correo que puede atender el asistente. La elección solo
 * cambia cómo se conecta la cuenta: el triaje, los borradores y el envío
 * funcionan idénticos con los tres.
 */
const proveedoresCorreo: Record<
  ProveedorCorreo,
  {
    label: readonly [string, string];
    description: readonly [string, string];
    comoConecta: readonly [string, string];
  }
> = {
  gmail: {
    label: ["Gmail / Google Workspace", "Gmail / Google Workspace"],
    description: [
      "Cuentas @gmail.com y dominios en Google Workspace.",
      "@gmail.com accounts and Google Workspace domains.",
    ],
    comoConecta: [
      "El ejecutivo autoriza con un clic desde su panel.",
      "The executive authorizes access with one click from their dashboard.",
    ],
  },
  microsoft: {
    label: ["Microsoft / Outlook", "Microsoft / Outlook"],
    description: [
      "Outlook.com, Hotmail, Live y Microsoft 365 corporativo.",
      "Outlook.com, Hotmail, Live, and business Microsoft 365 accounts.",
    ],
    comoConecta: [
      "El ejecutivo autoriza con un clic desde su panel.",
      "The executive authorizes access with one click from their dashboard.",
    ],
  },
  imap: {
    label: ["Correo corporativo (IMAP)", "Business email (IMAP)"],
    description: [
      "Cualquier dominio propio con IMAP y SMTP.",
      "Any custom domain with IMAP and SMTP.",
    ],
    comoConecta: [
      "El ejecutivo carga los datos de su servidor desde su panel; la contraseña se guarda cifrada.",
      "The executive enters the server details from their dashboard; the password is stored encrypted.",
    ],
  },
};

const botBehaviors: Record<
  BotBehavior,
  {
    label: readonly [string, string];
    description: readonly [string, string];
    icon: typeof Bot;
  }
> = {
  sales: {
    label: ["Ventas, agendamiento y fidelización", "Sales, scheduling, and retention"],
    description: [
      "Capta clientes, coordina reservas y fortalece la relación postventa.",
      "Captures leads, coordinates bookings, and strengthens the post-sale relationship.",
    ],
    icon: Bot,
  },
  technical_support: {
    label: ["Soporte técnico especializado", "Specialized technical support"],
    description: [
      "Diagnostica, guía paso a paso y escala casos complejos sin vender.",
      "Diagnoses issues, provides step-by-step guidance, and escalates complex cases without selling.",
    ],
    icon: BrainCircuit,
  },
  personal_assistant: {
    label: ["Asistente personal", "Personal assistant"],
    description: [
      "Le quita carga administrativa al ejecutivo: tría su correo, deja borradores listos y solo lo interrumpe con lo que amerita su criterio.",
      "Reduces the executive's administrative load: triages email, prepares drafts, and only interrupts when human judgment is needed.",
    ],
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
const contextoPorComportamiento: Record<
  BotBehavior,
  { label: readonly [string, string]; placeholder: readonly [string, string] }
> = {
  sales: {
    label: ["Información de la empresa", "Company information"],
    placeholder: [
      "Describe a qué se dedica la empresa, sus servicios, políticas, garantías, procesos y cualquier información útil para atender correctamente.",
      "Describe what the company does, its services, policies, warranties, processes, and any information needed to serve customers correctly.",
    ],
  },
  technical_support: {
    label: ["Información de la empresa", "Company information"],
    placeholder: [
      "Describe los productos que soporta, fallas frecuentes, políticas de garantía y devolución, y los pasos de diagnóstico habituales.",
      "Describe supported products, common failures, warranty and return policies, and the usual diagnostic steps.",
    ],
  },
  personal_assistant: {
    label: ["Contexto del ejecutivo", "Executive context"],
    placeholder: [
      "¿A quién asiste y a qué se dedica? Qué asuntos son prioritarios para él, con qué remitentes o temas debe tener especial cuidado, y qué puede resolver sin consultarle.",
      "Who does the bot assist and what do they do? Which matters are high priority, which senders or topics require special care, and what can be resolved without consulting them?",
    ],
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
  const { language, text } = useLanguage();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [holidayDraft, setHolidayDraft] = useState("");
  const [result, setResult] = useState<BuildResult | null>(null);

  useEffect(() => {
    const addressDefaults = ["Atención por WhatsApp", "WhatsApp support"];
    const hoursDefaults = [
      "Lunes a viernes de 9:00 AM a 6:00 PM",
      "Monday through Friday, 9:00 AM to 6:00 PM",
    ];
    setDraft((current) => ({
      ...current,
      direccion: addressDefaults.includes(current.direccion)
        ? language === "es"
          ? addressDefaults[0]
          : addressDefaults[1]
        : current.direccion,
      horario: hoursDefaults.includes(current.horario)
        ? language === "es"
          ? hoursDefaults[0]
          : hoursDefaults[1]
        : current.horario,
    }));
  }, [language]);

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

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result?.job?.logs?.length) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [result?.job?.logs]);

  // Suscripción en tiempo real a Supabase Realtime (Cero polling)
  useEffect(() => {
    const jobId = result?.job?.id;
    if (!jobId) return;

    const channel = supabase
      .channel(`bot_builder_job_${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "provision_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;

          const isDone = row.status === "completed";
          const isFailed = row.status === "failed";
          const state = isDone ? "complete" : isFailed ? "failed" : (row.status as any);
          const progress = isDone ? 100 : isFailed ? 100 : row.status === "running" ? 60 : 15;
          const logsArray = Array.isArray(row.logs) ? (row.logs as string[]) : [];
          const lastLog = logsArray[logsArray.length - 1] || "";
          const phase = lastLog ? lastLog.replace(/^\[[^\]]+\]\s*/, "") : "Procesando...";

          setResult((current) => {
            if (!current) return current;
            const updatedJob: ProvisionJob = {
              ...(current.job || {}),
              id: row.id,
              state,
              progress,
              phase,
              error: isFailed ? lastLog : null,
              appName: row.fly_app_name || current.job?.appName || "",
              clientId: current.job?.clientId || "",
              slug: row.tenant_slug,
              botStatusUrl: row.fly_app_name
                ? `https://${row.fly_app_name}.fly.dev/api/${row.tenant_slug}/config/bot-activo`
                : current.botStatusUrl,
              dashboardUrl: row.fly_app_name
                ? `https://${row.fly_app_name}.fly.dev/?tenant=${row.tenant_slug}&api=https://${row.fly_app_name}.fly.dev`
                : (current.dashboardUrl || ""),
              botId: current.job?.botId || null,
              microsoftRedirectUri: current.job?.microsoftRedirectUri || null,
              logs: logsArray,
            };

            return {
              ...current,
              job: updatedJob,
              botStatusUrl: updatedJob.botStatusUrl,
              dashboardUrl: updatedJob.dashboardUrl,
            };
          });

          if (isDone) {
            toast.success(
              text(
                "Bot desplegado con éxito en Fly.io.",
                "Bot deployed successfully on Fly.io.",
              ),
            );
          }
          if (isFailed) {
            toast.error(
              lastLog || text("El despliegue en Fly.io falló.", "Deployment on Fly.io failed."),
            );
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [result?.job?.id, text]);

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
    if (!selectedClient)
      return toast.error(
        text("Primero elige un cliente existente.", "Choose an existing client first."),
      );
    if (!slug)
      return toast.error(text("El bot necesita un slug válido.", "The bot needs a valid slug."));
    // Un asistente sin correo no tiene bandeja que triar: se pide aquí y no
    // se completa nunca a mano en el repositorio.
    if (draft.whatsappProvider === "meta_cloud" && !/^\d{5,}$/.test(draft.metaPhoneNumberId)) {
      return toast.error(text("Indica el Phone number ID de Meta.", "Enter the Meta Phone number ID."));
    }
    if (draft.botType === "assistant") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.asistenteCorreo.trim())) {
        return toast.error(
          text(
            "Indica el correo que este asistente va a atender.",
            "Enter the email account this assistant will manage.",
          ),
        );
      }
      if (draft.asistenteWhatsapp.replace(/\D/g, "").length < 8) {
        return toast.error(
          text(
            "Indica el WhatsApp (con código de país) donde el ejecutivo recibirá las alertas.",
            "Enter the WhatsApp number (including country code) where the executive will receive alerts.",
          ),
        );
      }
    }
    setSaving(true);
    setResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token)
        throw new Error(
          text(
            "Tu sesión expiró. Inicia sesión nuevamente.",
            "Your session expired. Sign in again.",
          ),
        );
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
            whatsapp: {
              provider: draft.whatsappProvider,
              phoneNumberId: draft.metaPhoneNumberId,
              businessAccountId: draft.metaBusinessAccountId,
              apiVersion: draft.metaApiVersion,
            },
            schedule: {
              businessDays: draft.businessDays,
              businessStart: draft.businessStart,
              businessEnd: draft.businessEnd,
              quietStart: draft.quietStart,
              quietEnd: draft.quietEnd,
              holidays: draft.holidays,
              appointmentReminderTime: draft.appointmentReminderTime,
              dailyReportTime:
                draft.botType === "assistant" ? draft.asistenteHoraReporte : draft.dailyReportTime,
            },
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
          groqKeyMode: draft.groqKeyMode,
          updateClient: draft.updateClient,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(
          body?.error ?? text("No se pudo crear el bot.", "The bot could not be created."),
        );
      if (body?.draft && body?.slug) {
        toast.success(
          text(
            "Borrador guardado. Vamos a probarlo antes de publicar.",
            "Draft saved. Let's test it before publishing.",
          ),
        );
        await navigate({ to: "/quality-center", search: { slug: body.slug } as never });
        return;
      }
      setResult(body as BuildResult);
      toast.success(text("Publicación iniciada.", "Publishing started."));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : text("No se pudo crear el bot.", "The bot could not be created."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
      {/* Header Estilo Vercel/Apple */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-white/5 pb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-zinc-300 backdrop-blur-md">
            <Bot className="h-3 w-3 text-primary" />
            {text("Fábrica de bots", "Bot Factory")}
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {text("Crear bot para cliente", "Create Client Bot")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base leading-relaxed">
            {text(
              "Elige la función y añade únicamente la información del negocio. Las políticas de seguridad se aplican en el backend; primero se prueba en borrador y no se crea ninguna máquina hasta que tú lo apruebes.",
              "Choose the function and add only the business information. Safety policies are enforced by the backend; the bot is tested as a draft first, and no machine is created until you approve it.",
            )}
          </p>
        </div>
        <Button
          className="h-11 rounded-xl px-6 font-medium shadow-lg shadow-primary/20 transition-all duration-200 hover:shadow-primary/30 gap-2 shrink-0"
          disabled={saving || loading}
          onClick={commitBot}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {text("Guardar y probar bot", "Save and test bot")}
        </Button>
      </div>

      <div className="space-y-6">
        {/* Sección 1: Cliente y tipo de bot (Glassmorphic Card) */}
        <Card className="rounded-2xl border border-white/10 bg-zinc-900/40 p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all hover:border-white/15">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                {text("1. Cliente y tipo de bot", "1. Client and bot type")}
              </h3>
              <p className="text-xs text-zinc-400">
                {text("Vincula el bot al cliente y define su canal principal.", "Link the bot to the client and define its primary channel.")}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <div className="space-y-2 md:max-w-md">
              <Label className="text-xs font-medium text-zinc-300">
                {text("Cliente existente", "Existing client")}
              </Label>
              <Select value={draft.clientId} onValueChange={selectClient}>
                <SelectTrigger className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100 backdrop-blur-md focus:border-white/20 focus:ring-white/10">
                  <SelectValue
                    placeholder={
                      loading
                        ? text("Cargando clientes...", "Loading clients...")
                        : text("Elegir cliente", "Choose client")
                    }
                  />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-950/95 backdrop-blur-xl text-zinc-100">
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {(Object.keys(botTypes) as BotType[]).map((type) => {
              const Icon = botTypes[type].icon;
              const active = draft.botType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectBotType(type)}
                  className={
                    "rounded-xl border p-5 text-left transition-all duration-200 " +
                    (active
                      ? "border-primary/60 bg-primary/10 text-white shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15 hover:bg-zinc-900/50 hover:text-zinc-200")
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <div className={"flex h-7 w-7 items-center justify-center rounded-lg " + (active ? "bg-primary/20 text-primary" : "bg-white/5 text-zinc-400")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">{text(...botTypes[type].label)}</span>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed opacity-85">{text(...botTypes[type].description)}</p>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Sección 2: Función del bot (Glassmorphic Card) */}
        <Card className="rounded-2xl border border-white/10 bg-zinc-900/40 p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all hover:border-white/15">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-primary">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                {text("2. Función del bot", "2. Bot function")}
              </h3>
              <p className="text-xs text-zinc-400">
                {text(
                  "Cada función incluye comportamiento, límites, herramientas autorizadas y reglas de escalamiento predeterminadas.",
                  "Each function includes default behavior, limits, authorized tools, and escalation rules.",
                )}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {availableBehaviors.map((behavior) => {
              const Icon = botBehaviors[behavior].icon;
              const active = draft.behavior === behavior;
              return (
                <button
                  key={behavior}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, behavior }))}
                  className={
                    "rounded-xl border p-5 text-left transition-all duration-200 " +
                    (active
                      ? "border-primary/60 bg-primary/10 text-white shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                      : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15 hover:bg-zinc-900/50 hover:text-zinc-200")
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <div className={"flex h-7 w-7 items-center justify-center rounded-lg " + (active ? "bg-primary/20 text-primary" : "bg-white/5 text-zinc-400")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">
                      {text(...botBehaviors[behavior].label)}
                    </span>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed opacity-85">
                    {text(...botBehaviors[behavior].description)}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-300/90 leading-relaxed">
            {text(
              "Incluido automáticamente: protección del prompt y datos privados, bloqueo fuera del negocio, precios solo desde catálogo, acciones delicadas con aprobación humana y validación de herramientas.",
              "Included automatically: prompt and private-data protection, out-of-scope blocking, catalog-only pricing, human approval for sensitive actions, and tool validation.",
            )}
          </div>

          {/* WhatsApp Connection */}
          <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            <h4 className="text-sm font-medium text-zinc-200">{text("Conexión de WhatsApp", "WhatsApp connection")}</h4>
            <p className="mt-1 text-xs text-zinc-400">
              {text("Elige QR para pilotos o Meta Cloud para clientes críticos. Los secretos se pedirán solo al publicar.", "Choose QR for pilots or Meta Cloud for critical clients. Secrets are requested only when publishing.")}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, whatsappProvider: "baileys" }))}
                className={`rounded-xl border p-4 text-left transition-all ${draft.whatsappProvider === "baileys" ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40 text-white" : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15"}`}
              >
                <span className="text-sm font-medium text-zinc-200">{text("QR · piloto", "QR · pilot")}</span>
                <p className="mt-1 text-xs text-zinc-400">{text("Conexión rápida mediante WhatsApp Web.", "Fast connection through WhatsApp Web.")}</p>
              </button>
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, whatsappProvider: "meta_cloud" }))}
                className={`rounded-xl border p-4 text-left transition-all ${draft.whatsappProvider === "meta_cloud" ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40 text-white" : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15"}`}
              >
                <span className="text-sm font-medium text-zinc-200">Meta WhatsApp Cloud API</span>
                <p className="mt-1 text-xs text-zinc-400">{text("Canal oficial para operación crítica y mayor estabilidad.", "Official channel for critical, higher-stability operations.")}</p>
              </button>
            </div>
            {draft.whatsappProvider === "meta_cloud" && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="space-y-2"><Label className="text-xs font-medium text-zinc-300">Phone number ID</Label><Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" value={draft.metaPhoneNumberId} onChange={(event) => setDraft((current) => ({ ...current, metaPhoneNumberId: event.target.value.replace(/\D/g, "") }))} /></div>
                <div className="space-y-2"><Label className="text-xs font-medium text-zinc-300">WhatsApp Business Account ID</Label><Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" value={draft.metaBusinessAccountId} onChange={(event) => setDraft((current) => ({ ...current, metaBusinessAccountId: event.target.value.replace(/\D/g, "") }))} /></div>
                <div className="space-y-2"><Label className="text-xs font-medium text-zinc-300">Graph API version</Label><Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" value={draft.metaApiVersion} onChange={(event) => setDraft((current) => ({ ...current, metaApiVersion: event.target.value }))} placeholder="v23.0" /></div>
              </div>
            )}
          </div>

          {/* AI Key Mode */}
          <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium text-zinc-200">
                  {text("Clave y modelo de inteligencia artificial", "AI key and model")}
                </h4>
                <p className="mt-1 text-xs text-zinc-400">
                  {text(
                    "GPT-OSS 120B se selecciona automáticamente por precisión, razonamiento y uso fiable de herramientas.",
                    "GPT-OSS 120B is selected automatically for accuracy, reasoning, and reliable tool use.",
                  )}
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({ ...current, groqKeyMode: "automatic" }))
                    }
                    className={`rounded-xl border p-4 text-left transition-all ${draft.groqKeyMode === "automatic" ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40 text-white" : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15"}`}
                  >
                    <span className="text-sm font-medium text-zinc-200">
                      {text("Automática · recomendada", "Automatic · recommended")}
                    </span>
                    <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                      {text(
                        "Usa la clave general de Stage. Es la opción correcta para la mayoría de los clientes.",
                        "Uses the general Stage key. This is the right option for most clients.",
                      )}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({ ...current, groqKeyMode: "dedicated" }))
                    }
                    className={`rounded-xl border p-4 text-left transition-all ${draft.groqKeyMode === "dedicated" ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40 text-white" : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15"}`}
                  >
                    <span className="text-sm font-medium text-zinc-200">
                      {text("Clave dedicada", "Dedicated key")}
                    </span>
                    <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                      {text(
                        "Para clientes grandes que necesitan límites y consumo independientes. La clave se solicita al publicar.",
                        "For large clients that need independent limits and usage. The key is requested when publishing.",
                      )}
                    </p>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {draft.botType === "assistant" && (
          <Card className="rounded-2xl border border-white/10 bg-zinc-900/40 p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all hover:border-white/15">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-primary">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                  {text("3. Correo y operación", "3. Email and operation")}
                </h3>
                <p className="text-xs text-zinc-400">
                  {text("Configuración del asistente ejecutivo para bandeja de entrada.", "Executive assistant inbox configuration.")}
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {text(
                "El asistente revisa este correo, descarta lo automatizado (no-reply, boletines y correo masivo) y responde el resto por su cuenta. Lo que debe decidir el titular en persona —temas legales, dinero comprometido, seguridad o conflictos delicados— nunca se envía: deja el borrador escrito y avisa por WhatsApp para que solo tenga que revisarlo y enviarlo. El ejecutivo autoriza su cuenta con un clic desde su panel.",
                "The assistant checks this inbox, discards automated messages (no-reply, newsletters, and bulk mail), and handles the rest. Matters requiring the owner's personal judgment—legal issues, financial commitments, security, or sensitive conflicts—are never sent automatically: a draft is prepared and the owner is notified through WhatsApp to review and send it. The executive authorizes the account with one click from their dashboard.",
              )}
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {(Object.keys(proveedoresCorreo) as ProveedorCorreo[]).map((p) => {
                const activo = draft.asistenteProveedor === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, asistenteProveedor: p }))}
                    className={
                      "rounded-xl border p-5 text-left transition-all duration-200 " +
                      (activo
                        ? "border-primary/60 bg-primary/10 text-white shadow-lg shadow-primary/10 ring-1 ring-primary/40"
                        : "border-white/5 bg-zinc-950/40 text-zinc-400 hover:border-white/15 hover:bg-zinc-900/50 hover:text-zinc-200")
                    }
                  >
                    <span className="text-sm font-semibold tracking-tight text-zinc-200">
                      {text(...proveedoresCorreo[p].label)}
                    </span>
                    <p className="mt-2 text-xs leading-relaxed opacity-85">
                      {text(...proveedoresCorreo[p].description)}
                    </p>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-zinc-400">
              {text(...proveedoresCorreo[draft.asistenteProveedor].comoConecta)}
            </p>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <Field label={text("Correo a asistir", "Email account to manage")}>
                <Input
                  type="email"
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100 placeholder:text-zinc-500"
                  value={draft.asistenteCorreo}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, asistenteCorreo: event.target.value }))
                  }
                  placeholder="director@empresa.com"
                />
              </Field>
              <Field label={text("WhatsApp para alertas", "WhatsApp for alerts")}>
                <Input
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100 placeholder:text-zinc-500"
                  value={draft.asistenteWhatsapp}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, asistenteWhatsapp: event.target.value }))
                  }
                  placeholder="18091234567"
                />
              </Field>
              <div className="space-y-2 md:col-span-2">
                <Field
                  label={`${text("Exigencia para redactar", "Drafting confidence threshold")} — ${Math.round(draft.asistenteUmbral * 100)}%`}
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
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {text(
                      "Red de seguridad del envío automático: si no entendió el correo por encima de este nivel, no lo envía; lo deja como borrador para que lo revise el titular. Súbelo si notas que se envían respuestas flojas; bájalo si escala de más.",
                      "Automatic-send safety threshold: if the assistant does not understand an email above this level, it will not send it and will leave a draft for the owner. Raise it if weak responses are being sent; lower it if too many messages are escalated.",
                    )}
                  </p>
                </Field>
              </div>
              <Field label={text("Revisar la bandeja cada", "Check the inbox every")}>
                <Select
                  value={String(draft.asistenteIntervalo)}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, asistenteIntervalo: Number(value) }))
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-zinc-950/95 backdrop-blur-xl text-zinc-100">
                    <SelectItem value="5">{text("5 minutos", "5 minutes")}</SelectItem>
                    <SelectItem value="10">
                      {text("10 minutos — recomendado", "10 minutes — recommended")}
                    </SelectItem>
                    <SelectItem value="15">{text("15 minutos", "15 minutes")}</SelectItem>
                    <SelectItem value="30">{text("30 minutos", "30 minutes")}</SelectItem>
                    <SelectItem value="60">{text("1 hora", "1 hour")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={text("Hora del reporte de fin de día", "End-of-day report time")}>
                <Input
                  type="time"
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
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

            <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium text-zinc-200">
                    {text(
                      "Enviar solo los correos rutinarios",
                      "Automatically send routine emails",
                    )}
                  </Label>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    {text(
                      "Activado: responde y envía por su cuenta lo rutinario (consultas simples, acuses, agradecimientos y seguimiento). Lo delicado y lo que no entienda nunca se envía: queda como borrador con aviso. Desactivado: no envía nada; todo queda en borradores.",
                      "On: responds to and sends routine messages automatically (simple questions, acknowledgements, thanks, and follow-ups). Sensitive or unclear messages are never sent and remain as drafts with an alert. Off: nothing is sent; every response remains a draft.",
                    )}
                  </p>
                  <p className="mt-2 text-xs text-amber-400/90 font-medium">
                    {text(
                      "Recomendamos dejarlo apagado al empezar: el cliente debe revisar algunos días de borradores y activarlo cuando la calidad le convenza. Un correo enviado a su nombre no se puede retirar.",
                      "We recommend leaving this off at first: the client should review drafts for a few days and enable it once the quality is satisfactory. An email sent in their name cannot be recalled.",
                    )}
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

            <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium text-zinc-200">
                    {text("Escribir con el nombre del titular", "Write in the owner's name")}
                  </Label>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                    {text(
                      "Activado: redacta en primera persona como el titular, sin mencionar que hay un asistente. Desactivado: se presenta como asistente que escribe en su nombre.",
                      "On: writes in the first person as the owner without mentioning an assistant. Off: identifies itself as an assistant writing on the owner's behalf.",
                    )}
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
                <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
                  <Field label={text("Nombre con el que firma", "Signature name")}>
                    <Input
                      className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                      value={draft.asistenteNombreTitular}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          asistenteNombreTitular: event.target.value,
                        }))
                      }
                      placeholder={
                        selectedClient?.company_name ??
                        text("Nombre del titular o de la empresa", "Owner or company name")
                      }
                    />
                  </Field>
                  <p className="text-xs text-zinc-400">
                    {text(
                      "Con el envío automático activo, estos correos salen a nombre del titular sin que él los lea antes. Lo delicado sigue quedando como borrador para su revisión.",
                      "When automatic sending is enabled, these emails are sent in the owner's name without prior review. Sensitive messages still remain as drafts for review.",
                    )}
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Sección 3 / 4: Información y personalización (Glassmorphic Card) */}
        <Card className="rounded-2xl border border-white/10 bg-zinc-900/40 p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/40 transition-all hover:border-white/15">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                {draft.botType === "assistant" ? "4" : "3"}.{" "}
                {text("Información y personalización", "Information and customization")}
              </h3>
              <p className="text-xs text-zinc-400">
                {text(
                  "La identidad técnica, la URL, el modelo y el vínculo con el cliente se generan automáticamente.",
                  "The technical identity, URL, model, and client relationship are generated automatically.",
                )}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {muestra("moneda") && (
              <Field label={text("Moneda", "Currency")}>
                <Input
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                  value={draft.moneda}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, moneda: event.target.value }))
                  }
                  placeholder="USD"
                />
              </Field>
            )}
            {muestra("horario") && (
              <Field label={text("Horario", "Hours")}>
                <Input
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                  value={draft.horario}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, horario: event.target.value }))
                  }
                />
              </Field>
            )}
            <Field label={text("Zona horaria", "Timezone")}>
              <Input
                className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                value={draft.zonaHoraria}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, zonaHoraria: event.target.value }))
                }
              />
            </Field>

            {/* Calendario Operativo */}
            <div className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-5 sm:p-6 backdrop-blur-md md:col-span-2">
              <div>
                <Label className="text-sm font-medium text-zinc-200">{text("Calendario operativo", "Operating calendar")}</Label>
                <p className="mt-1 text-xs text-zinc-400">
                  {text(
                    "Controla reportes, recordatorios y mensajes proactivos. Las consultas entrantes siguen siendo atendidas.",
                    "Controls reports, reminders, and proactive messages. Incoming questions are still handled.",
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-zinc-300">{text("Días laborables", "Business days")}</Label>
                <div className="flex flex-wrap gap-2">
                  {scheduleDays.map((day) => {
                    const selected = draft.businessDays.includes(day.value);
                    return (
                      <Button
                        key={day.value}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className={selected ? "rounded-xl shadow-md" : "rounded-xl border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            businessDays: selected
                              ? current.businessDays.filter((value) => value !== day.value)
                              : [...current.businessDays, day.value],
                          }))
                        }
                      >
                        {text(day.label[0], day.label[1])}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={text("Abre", "Opens")}>
                  <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.businessStart} onChange={(event) => setDraft((current) => ({ ...current, businessStart: event.target.value }))} />
                </Field>
                <Field label={text("Cierra", "Closes")}>
                  <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.businessEnd} onChange={(event) => setDraft((current) => ({ ...current, businessEnd: event.target.value }))} />
                </Field>
                <Field label={text("Silencio desde", "Quiet from")}>
                  <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.quietStart} onChange={(event) => setDraft((current) => ({ ...current, quietStart: event.target.value }))} />
                </Field>
                <Field label={text("Silencio hasta", "Quiet until")}>
                  <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.quietEnd} onChange={(event) => setDraft((current) => ({ ...current, quietEnd: event.target.value }))} />
                </Field>
                <Field label={text("Recordar citas", "Appointment reminders")}>
                  <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.appointmentReminderTime} onChange={(event) => setDraft((current) => ({ ...current, appointmentReminderTime: event.target.value }))} />
                </Field>
                {draft.botType !== "assistant" && (
                  <Field label={text("Reporte diario", "Daily report")}>
                    <Input className="h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" type="time" value={draft.dailyReportTime} onChange={(event) => setDraft((current) => ({ ...current, dailyReportTime: event.target.value }))} />
                  </Field>
                )}
              </div>

              <div className="space-y-2 border-t border-white/5 pt-4">
                <Label className="text-xs font-medium text-zinc-300">{text("Feriados y cierres", "Holidays and closures")}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input type="date" className="w-48 h-10 rounded-xl border-white/10 bg-black/50 text-zinc-100" value={holidayDraft} onChange={(event) => setHolidayDraft(event.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                    disabled={!holidayDraft || draft.holidays.includes(holidayDraft)}
                    onClick={() => {
                      setDraft((current) => ({ ...current, holidays: [...current.holidays, holidayDraft].sort() }));
                      setHolidayDraft("");
                    }}
                  >
                    {text("Agregar cierre", "Add closure")}
                  </Button>
                </div>
                {draft.holidays.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {draft.holidays.map((date) => (
                      <Button key={date} type="button" size="sm" variant="secondary" className="rounded-xl border border-white/10 bg-white/5 text-zinc-300" onClick={() => setDraft((current) => ({ ...current, holidays: current.holidays.filter((value) => value !== date) }))}>
                        {date} ×
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {muestra("direccion") && (
              <Field label={text("Dirección", "Address")}>
                <Input
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                  value={draft.direccion}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, direccion: event.target.value }))
                  }
                />
              </Field>
            )}
            {muestra("contacto") && (
              <Field label={text("Contacto", "Contact")}>
                <Input
                  className="h-11 rounded-xl border-white/10 bg-black/40 text-zinc-100"
                  value={draft.contacto}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, contacto: event.target.value }))
                  }
                />
              </Field>
            )}
          </div>

          {muestra("cotizaPorChat") && (
            <div className="mt-5">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
                <div>
                  <Label className="text-sm font-medium text-zinc-200">{text("Puede cotizar por chat", "Can quote by chat")}</Label>
                  <p className="mt-1 text-xs text-zinc-400">
                    {text(
                      "Desactívalo para negocios que solo cotizan después de una inspección.",
                      "Turn this off for businesses that quote only after an inspection.",
                    )}
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

          <div className="mt-6 space-y-2">
            <Label className="text-xs font-medium text-zinc-300">{text(...contexto.label)}</Label>
            <Textarea
              rows={5}
              className="rounded-xl border-white/10 bg-black/40 text-zinc-100 placeholder:text-zinc-500 backdrop-blur-sm focus:border-white/20"
              value={draft.companyInfo}
              onChange={(event) =>
                setDraft((current) => ({ ...current, companyInfo: event.target.value }))
              }
              placeholder={text(...contexto.placeholder)}
            />
          </div>

          <div className="mt-6 space-y-2">
            <Label className="text-xs font-medium text-zinc-300">
              {text(
                "Personalización: restricciones y comportamiento",
                "Customization: restrictions and behavior",
              )}
            </Label>
            <Textarea
              rows={4}
              className="rounded-xl border-white/10 bg-black/40 text-zinc-100 placeholder:text-zinc-500 backdrop-blur-sm focus:border-white/20"
              value={draft.extraPrompt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, extraPrompt: event.target.value }))
              }
              placeholder={text(
                "Ej.: qué debe escalar, tono preferido, excepciones autorizadas y límites particulares. Las reglas de seguridad base no se pueden eliminar.",
                "Example: what to escalate, preferred tone, authorized exceptions, and client-specific limits. Base safety rules cannot be removed.",
              )}
            />
            <p className="text-xs text-zinc-400">
              {text(
                "Este campo complementa la función predeterminada; no sustituye las políticas internas de seguridad.",
                "This field supplements the default function; it does not replace internal safety policies.",
              )}
            </p>
          </div>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-zinc-300 backdrop-blur-md">
            {text(
              "Siguiente paso: se guarda un borrador y se abre el Centro de Calidad. Allí probarás respuestas, decisiones, herramientas e infraestructura antes de habilitar “Crear y publicar bot”.",
              "Next step: a draft is saved and the Quality Center opens. There you will test responses, decisions, tools, and infrastructure before enabling “Create and publish bot.”",
            )}
          </div>
        </Card>

        {result && (
          <div className="space-y-4">
            {/* Terminal de Logs en tiempo real (Supabase Realtime) */}
            <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-black/80 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="ml-2 font-mono text-xs text-zinc-400">
                    fly-machines :: {result.job?.appName || result.slug}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {result.job?.state === "running" && (
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      {text("desplegando", "deploying")}
                    </span>
                  )}
                  {result.job?.state === "queued" && (
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-amber-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                      {text("en cola", "queued")}
                    </span>
                  )}
                  {result.job?.state === "complete" && (
                    <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {text("completado", "completed")}
                    </span>
                  )}
                  {result.job?.state === "failed" && (
                    <span className="flex items-center gap-1 font-mono text-[11px] text-rose-400">
                      <XCircle className="h-3.5 w-3.5" /> {text("error", "error")}
                    </span>
                  )}
                </div>
              </div>

              {/* Barra de progreso */}
              {result.job && (
                <div className="border-b border-zinc-800/50 bg-zinc-900/20 px-4 py-2">
                  <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400">
                    <span className="truncate">{result.job.phase}</span>
                    <span className="font-semibold text-zinc-200">{result.job.progress}%</span>
                  </div>
                  <Progress className="mt-1.5 h-1 bg-zinc-800/80" value={result.job.progress} />
                </div>
              )}

              {/* Logs Viewport */}
              <div className="max-h-64 min-h-[120px] overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
                {(!result.job?.logs || result.job.logs.length === 0) ? (
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                    <span>{text("Conectando al stream de Supabase Realtime...", "Connecting to Supabase Realtime stream...")}</span>
                  </div>
                ) : (
                  result.job.logs.map((log, idx) => {
                    const isErr = log.includes("ERROR");
                    const isSuccess = log.includes("éxito") || log.includes("OK") || log.includes("completado");
                    return (
                      <div
                        key={idx}
                        className={
                          "flex items-start gap-2 py-0.5 " +
                          (isErr
                            ? "text-rose-400 font-medium"
                            : isSuccess
                              ? "text-emerald-300 font-medium"
                              : "text-zinc-300")
                        }
                      >
                        <span className="select-none text-zinc-600">›</span>
                        <span className="break-all">{log}</span>
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>

            {/* Metadatos y Accesos */}
            <Card className="border border-zinc-800/60 bg-zinc-950/40 p-5 backdrop-blur-md">
              <div className="grid gap-4 sm:grid-cols-2">
                <ResultLine
                  label={text("Archivo del cliente", "Tenant file")}
                  value={result.tenantPath}
                />
                <ResultLine label="Bot URL" value={result.botStatusUrl} />
              </div>

              {result.job?.state === "complete" && (
                <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/90">
                  {text(
                    "Falta crear el usuario del cliente en Gestión de clientes → Acceso → Administrar usuarios, y luego conectar WhatsApp desde el QR.",
                    "Create the client's user in Client Manager → Access → Manage users, then connect WhatsApp using the QR code.",
                  )}
                </div>
              )}

              {result.job?.microsoftRedirectUri && (
                <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                  <p className="font-medium text-foreground">
                    {text(
                      "Antes de que el cliente conecte Outlook: registra este URI en Entra ID",
                      "Before the client connects Outlook: register this URI in Entra ID",
                    )}
                  </p>
                  <code className="mt-2 block break-all rounded bg-black/60 p-2 font-mono text-[11px] text-zinc-200">
                    {result.job.microsoftRedirectUri}
                  </code>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {result.dashboardUrl && (
                  <a
                    href={result.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-lg border border-zinc-700/60 bg-zinc-900/60 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
                  >
                    {text("Abrir panel del cliente", "Open client dashboard")}
                  </a>
                )}
                {result.commitUrl && (
                  <a
                    href={result.commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {text("Abrir cambio en GitHub", "Open GitHub commit")}
                  </a>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-zinc-300">{label}</Label>
      {children}
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-zinc-200">{value}</p>
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

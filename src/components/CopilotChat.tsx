import { useEffect, useRef, useState } from "react";
import {
  Bot,
  User,
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  Database,
  FileCode,
  Globe,
  Trash2,
  ArrowRight,
  ShieldCheck,
  Copy,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/use-language";
import { useNavigate } from "@tanstack/react-router";

export interface ChatMessage {
  id: string;
  role: "user" | "copilot" | "system";
  content: string;
  timestamp: string;
  functionCall?: {
    name: string;
    args: {
      slug?: string;
      name?: string;
      phone?: string;
      tokens?: number;
      budget?: number;
      prompt?: string;
    };
    result?: {
      success: boolean;
      message: string;
      data?: {
        slug: string;
        name: string;
        phone: string;
        monthlyTokens: number;
        monthlyBudgetUsd: number;
        model: string;
        prompt: string;
      };
      normalized?: {
        slug: string;
        phone: string;
        whatsappJid: string;
        monthlyTokens: number;
        monthlyBudgetUsd: number;
      };
      files?: {
        configPath: string;
        sqlPath: string;
        templateConfigPath?: string;
      };
      supabase?: {
        success: boolean;
        message: string;
      };
    };
  };
}

const INITIAL_GREETING: ChatMessage = {
  id: "greeting",
  role: "copilot",
  content:
    "¡Hola! Soy el **Copiloto de Infraestructura de Stage AI Labs**. Estoy conectado directamente con Gemini y los motores de aprovisionamiento de nuestra plataforma.\n\nPuedes pedirme en lenguaje natural crear un bot para cualquier cliente o empresa, por ejemplo:\n* *«Aprovisiona un bot para Domínguez Auto Pintura, WhatsApp +1 809 555 0199, taller de pintura y desabolladura, presupuesto $50/mes»*.\n\nYo me encargo de validar la sintaxis, generar las configuraciones de producción y sincronizar la base de datos de Supabase.",
  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
};

const SUGGESTED_PROMPTS = [
  {
    title: "Taller Automotriz",
    text: "Aprovisiona un bot para Domínguez Auto Pintura (+1 809 555 0199). Es un taller de desabolladura y pintura horneada de alta gama. Presupuesto $50/mes con 10M de tokens.",
    category: "Servicios",
  },
  {
    title: "Clínica Odontológica",
    text: "Crear un bot para Clínica Dental Sonrisas (+1 809 555 4321). Consultas, citas de profilaxis y diseño de sonrisa con horario de lunes a sábado.",
    category: "Salud",
  },
  {
    title: "Inmobiliaria y Bienes Raíces",
    text: "Alta de bot de ventas para Inmobiliaria Deluxe (+1 829 555 9876). Venta y alquiler de villas en Punta Cana. Presupuesto $100/mes con 20M tokens.",
    category: "Real Estate",
  },
  {
    title: "Restaurante Gourmet",
    text: "Aprovisionar bot de atención y reservas para Bistro Criollo (+1 849 555 7788). Atención a clientes, menú digital y reservas de mesas.",
    category: "Gastronomía",
  },
];

export function CopilotChat() {
  const { text } = useLanguage();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [urlScanModal, setUrlScanModal] = useState(false);
  const [scanUrl, setScanUrl] = useState("");
  const [isScanningUrl, setIsScanningUrl] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || inputValue).trim();
    if (!content || isSending) return;

    const userMessage: ChatMessage = {
      id: "usr-" + Date.now(),
      role: "user",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputValue("");
    setIsSending(true);
    setStatusText("El Copiloto está analizando requerimientos con Gemini...");

    try {
      // Formatear historial para el endpoint /api/copilot
      const payloadMessages = newHistory
        .filter((m) => m.id !== "greeting")
        .map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        }));

      // Si el historial está vacío (solo estaba el greeting), enviamos el mensaje actual
      if (payloadMessages.length === 0) {
        payloadMessages.push({ role: "user", content });
      }

      setStatusText("Orquestando infraestructura y herramientas autónomas...");

      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }

      const copilotMessage: ChatMessage = {
        id: "cplt-" + Date.now(),
        role: "copilot",
        content: data.reply || "He procesado tu solicitud.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        functionCall: data.functionCall,
      };

      setMessages((prev) => [...prev, copilotMessage]);

      if (data.functionCall?.name === "provisionar_bot_cliente") {
        toast.success(
          `Tenant '${data.functionCall.args?.slug || "bot"}' aprovisionado exitosamente en Stage AI Labs.`,
        );
      }
    } catch (error) {
      console.error("[Copilot Chat Error]", error);
      const errorMessage: ChatMessage = {
        id: "err-" + Date.now(),
        role: "system",
        content: `Error al contactar con el Copiloto: ${error instanceof Error ? error.message : String(error)}. Por favor intenta nuevamente.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMessage]);
      toast.error("Ocurrió un error al procesar el mensaje con el Copiloto.");
    } finally {
      setIsSending(false);
      setStatusText("");
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        ...INITIAL_GREETING,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    toast.info("Conversación reiniciada.");
  };

  const handleScanUrlAndFill = async () => {
    if (!scanUrl.trim()) return;
    setIsScanningUrl(true);
    try {
      const res = await fetch("/api/magic-onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scanUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error || "No se pudo extraer la información de la URL.");
      }

      const { name, phone, prompt, businessHours } = data.data;
      const promptText = `Aprovisiona un bot para ${name} (${scanUrl.trim()}). Teléfono: ${phone || "por confirmar"}. Horario: ${businessHours || "Lunes a Viernes"}. Reglas de negocio: ${prompt}`;

      setUrlScanModal(false);
      setScanUrl("");
      void handleSendMessage(promptText);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al escanear la URL.");
    } finally {
      setIsScanningUrl(false);
    }
  };

  const copyToClipboard = (textToCopy: string, label: string) => {
    navigator.clipboard.writeText(textToCopy);
    toast.success(`${label} copiado al portapapeles.`);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)] max-w-6xl mx-auto w-full px-2 sm:px-4 pb-3">
      {/* Header del Copiloto */}
      <div className="flex items-center justify-between py-3 px-4 mb-3 rounded-2xl bg-[#0c0d14]/80 border border-white/10 backdrop-blur-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/20">
            <Bot className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                {text("Copiloto de Infraestructura", "Infrastructure Copilot")}
              </h1>
              <Badge
                variant="outline"
                className="bg-indigo-950/40 text-indigo-400 border-indigo-500/30 text-[11px] font-medium hidden sm:inline-flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-indigo-400" />
                Gemini 1.5 Flash • Agentic Tools
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {text(
                "Aprovisionamiento autónomo de bots, bases de datos y configuraciones en Stage AI Labs.",
                "Autonomous provisioning of bots, databases, and runtime configs in Stage AI Labs.",
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUrlScanModal(true)}
            className="text-xs border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 gap-1.5 h-8"
          >
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">{text("Escanear URL", "Scan URL")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetChat}
            className="text-xs text-muted-foreground hover:text-white hover:bg-white/5 h-8 gap-1.5"
            title={text("Limpiar conversación", "Clear chat")}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{text("Reiniciar", "Reset")}</span>
          </Button>
        </div>
      </div>

      {/* Modal / Popover para Escanear URL */}
      {urlScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#10121a] border border-indigo-500/30 rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2.5 text-indigo-400">
              <Globe className="w-5 h-5" />
              <h3 className="text-base font-semibold text-white">
                {text("Escanear Negocio desde URL", "Scan Business from URL")}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {text(
                "Pega el enlace del cliente. El Escáner Mágico extraerá el resumen y el Copiloto aprovisionará la infraestructura automáticamente.",
                "Paste the client's URL. The Magic Scanner will extract details and the Copilot will provision the bot.",
              )}
            </p>
            <input
              type="url"
              value={scanUrl}
              onChange={(e) => setScanUrl(e.target.value)}
              placeholder="https://empresa.com"
              className="w-full px-3.5 py-2.5 text-sm bg-black/50 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleScanUrlAndFill()}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUrlScanModal(false)}
                className="text-xs text-muted-foreground hover:text-white"
              >
                {text("Cancelar", "Cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleScanUrlAndFill}
                disabled={!scanUrl.trim() || isScanningUrl}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
              >
                {isScanningUrl ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {text("Escaneando...", "Scanning...")}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    {text("Escanear y Enviar", "Scan & Submit")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Área Principal de Mensajes */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 sm:pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isSystem = msg.role === "system";

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="text-xs text-amber-300/90 bg-amber-950/40 border border-amber-500/20 px-3.5 py-1.5 rounded-full backdrop-blur-md max-w-lg text-center">
                  {msg.content}
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-3 items-start ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-md shadow-indigo-500/20">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`flex flex-col space-y-1.5 max-w-[88%] sm:max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md backdrop-blur-md ${
                    isUser
                      ? "bg-gradient-to-r from-indigo-600/90 to-violet-600/90 text-white border border-indigo-400/30 rounded-tr-sm"
                      : "bg-[#11131c]/90 text-gray-200 border border-white/10 rounded-tl-sm"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                  {/* Card Especial de Function Call (Aprovisionamiento Ejecutado) */}
                  {msg.functionCall && msg.functionCall.name === "provisionar_bot_cliente" && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Badge
                          variant="outline"
                          className="bg-emerald-950/50 text-emerald-400 border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1.5 py-0.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          {text("Aprovisionamiento Exitoso", "Provisioning Completed")}
                        </Badge>
                        <span className="text-[11px] text-gray-400 font-mono">
                          tool: provisionar_bot_cliente
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-black/40 rounded-xl p-3 border border-white/5 font-mono">
                        <div>
                          <span className="text-gray-400">Tenant Slug: </span>
                          <span className="text-indigo-300 font-semibold">
                            {msg.functionCall.args.slug}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400">Empresa: </span>
                          <span className="text-white">{msg.functionCall.args.name}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">WhatsApp: </span>
                          <span className="text-emerald-300 font-semibold">
                            {msg.functionCall.args.phone}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400">Cuota: </span>
                          <span className="text-violet-300">
                            {msg.functionCall.args.tokens?.toLocaleString()} tokens (${msg.functionCall.args.budget} USD)
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <div className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-white/5 px-2.5 py-1 rounded-md border border-white/5">
                          <Database className="w-3 h-3 text-emerald-400" />
                          <span>Supabase DB: public.tenants & runtime_policies</span>
                        </div>
                        <div className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-white/5 px-2.5 py-1 rounded-md border border-white/5">
                          <FileCode className="w-3 h-3 text-indigo-400" />
                          <span>Config JSON & SQL generados</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(msg.functionCall?.args.slug || "", "Slug")}
                          className="text-[11px] h-6 px-2 text-gray-400 hover:text-white hover:bg-white/10 gap-1 ml-auto"
                        >
                          <Copy className="w-3 h-3" />
                          Copiar Slug
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <span className="text-[10px] text-muted-foreground px-1">
                  {msg.timestamp}
                </span>
              </div>

              {isUser && (
                <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-gray-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Indicador de Carga / Procesando */}
        {isSending && (
          <div className="flex gap-3 items-start justify-start animate-in fade-in duration-200">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shrink-0 shadow-md shadow-indigo-500/20">
              <Bot className="w-4 h-4" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-[#11131c]/90 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-3 backdrop-blur-md shadow-lg">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
              <span>{statusText || text("Procesando...", "Processing...")}</span>
            </div>
          </div>
        )}

        {/* Estado Vacío / Sugerencias si solo está el mensaje inicial */}
        {messages.length === 1 && !isSending && (
          <div className="pt-2 pb-6 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                {text("Sugerencias Rápidas de Aprovisionamiento", "Quick Provisioning Suggestions")}
              </p>
              <p className="text-xs text-muted-foreground">
                {text(
                  "Selecciona uno de los ejemplos o describe el negocio en tus propias palabras:",
                  "Select an example or describe your client in your own words:",
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-4xl mx-auto">
              {SUGGESTED_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(item.text)}
                  className="text-left p-3.5 rounded-xl bg-[#0e0f17]/70 hover:bg-[#151724]/90 border border-white/5 hover:border-indigo-500/40 transition-all duration-200 group flex flex-col justify-between space-y-2 shadow-sm"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-semibold text-white group-hover:text-indigo-300 transition-colors">
                      {item.title}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-white/5 text-gray-400 border-white/10"
                    >
                      {item.category}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.text}
                  </p>
                  <div className="flex items-center gap-1 text-[11px] text-indigo-400 font-medium pt-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <span>{text("Aprovisionar este ejemplo", "Provision this example")}</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Barra de Entrada Fija Inferior */}
      <div className="pt-2">
        <div className="relative rounded-2xl bg-[#0d0e16]/90 border border-white/10 p-2 shadow-2xl backdrop-blur-xl focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30 transition-all">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            rows={2}
            placeholder={text(
              "Escribe el nombre de la empresa, teléfono o detalles del bot a crear...",
              "Type the company name, phone, or details of the bot to create...",
            )}
            className="w-full bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none resize-none disabled:opacity-50"
          />

          <div className="flex items-center justify-between pt-1 px-1 border-t border-white/5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] text-gray-500">
                Presiona <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300 font-mono text-[10px]">Enter</kbd> para enviar
              </span>
            </div>

            <Button
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isSending}
              size="sm"
              className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl px-4 py-1.5 h-8 gap-1.5 shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="text-xs">{text("Aprovisionando...", "Provisioning...")}</span>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium">{text("Enviar", "Send")}</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

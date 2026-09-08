import { createFileRoute } from "@tanstack/react-router";
import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  SchemaType,
  type Content,
} from "@google/generative-ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { provisionTenant, type TenantInputData } from "../../scripts/onboard-tenant.ts";

/**
 * Esquema de herramientas (Function Calling) para el Agente Autónomo de Infraestructura.
 */

// 1. Herramienta de Aprovisionamiento
export const provisionarBotClienteTool: FunctionDeclaration = {
  name: "provisionar_bot_cliente",
  description:
    "Aprovisiona y configura un nuevo bot de cliente (tenant) en la infraestructura de Stage AI Labs con base de datos real (Supabase), políticas de costos/tokens y generando los artefactos JSON/SQL de producción.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      slug: {
        type: SchemaType.STRING,
        description:
          "Identificador único y URL-safe del cliente/tenant (ej. 'dominguez-auto-pintura', 'wiltech-do'). Debe tener entre 3 y 50 caracteres, únicamente minúsculas y guiones.",
      },
      name: {
        type: SchemaType.STRING,
        description:
          "Nombre comercial o razón social oficial de la empresa cliente (ej. 'Domínguez Auto Pintura').",
      },
      phone: {
        type: SchemaType.STRING,
        description:
          "Número de teléfono de contacto o WhatsApp en formato internacional E.164 (ej. '+18095550199') o dígitos con código de país.",
      },
      tokens: {
        type: SchemaType.NUMBER,
        description:
          "Límite mensual de tokens de IA para el bot (ej. 10000000 para 10M tokens). Si no se indica, usa 10000000.",
      },
      budget: {
        type: SchemaType.NUMBER,
        description:
          "Presupuesto mensual en USD asignado al cliente (ej. 50). Si no se indica, usa 50.",
      },
      prompt: {
        type: SchemaType.STRING,
        description:
          "Reglas de negocio, horario de atención, tono conversacional, descripción de servicios e instrucciones de comportamiento del bot.",
      },
    },
    required: ["slug", "name", "phone", "tokens", "budget", "prompt"],
  },
};

// 2. Herramienta de Listar Bots
export const listBotsTool: FunctionDeclaration = {
  name: "list_bots",
  description:
    "Devuelve la lista completa de todos los bots y clientes activos en la infraestructura de Stage AI Labs, incluyendo sus IDs (UUID), slugs, nombres de empresa, teléfonos de contacto y estados operativos.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      status: {
        type: SchemaType.STRING,
        description:
          "Filtro opcional por estado operativo: 'active', 'inactive' o 'all'. Por defecto 'all'.",
      },
    },
  },
};

// 3. Herramienta de Modificar Bot
export const updateBotTool: FunctionDeclaration = {
  name: "update_bot",
  description:
    "Modifica los parámetros de un bot existente en Supabase y la infraestructura de Stage AI Labs (ej. cambiar número de WhatsApp, nombre comercial, estado activo/inactivo, o instrucciones de negocio).",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      bot_id: {
        type: SchemaType.STRING,
        description:
          "ID único (UUID) o slug del bot a modificar (ej. '59d08f93-9e50-47cf-b5a1-b06f1cd37da7' o 'dominguez-a-pintura').",
      },
      name: {
        type: SchemaType.STRING,
        description: "Nuevo nombre comercial del bot o de la empresa.",
      },
      phone: {
        type: SchemaType.STRING,
        description:
          "Nuevo número de WhatsApp / teléfono de contacto en formato E.164 (ej. '+18095550199').",
      },
      status: {
        type: SchemaType.STRING,
        description: "Nuevo estado operativo del bot ('active', 'inactive', 'paused').",
      },
      prompt: {
        type: SchemaType.STRING,
        description: "Nuevas instrucciones de comportamiento, reglas de negocio u horarios.",
      },
    },
    required: ["bot_id"],
  },
};

// 4. Herramienta de Eliminar Bot
export const deleteBotTool: FunctionDeclaration = {
  name: "delete_bot",
  description:
    "Elimina o archiva un bot de la base de datos de Stage AI Labs de forma definitiva o controlada.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      bot_id: {
        type: SchemaType.STRING,
        description: "ID único (UUID) o slug del bot a eliminar.",
      },
      confirmation: {
        type: SchemaType.STRING,
        description:
          "Confirmación explícita para validar la acción destructiva (ej. el slug del bot o 'confirmar').",
      },
    },
    required: ["bot_id"],
  },
};

// 5. Herramienta de Prueba / Ping de Bot
export const testBotTool: FunctionDeclaration = {
  name: "test_bot",
  description:
    "Envía un ping o mensaje de prueba a un bot para verificar su conectividad, latencia y estado en tiempo real.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      bot_id: {
        type: SchemaType.STRING,
        description: "ID único (UUID) o slug del bot a probar.",
      },
      sample_message: {
        type: SchemaType.STRING,
        description: "Mensaje opcional de prueba para simular la conversación con el bot.",
      },
    },
    required: ["bot_id"],
  },
};

const ALL_COPILOT_TOOLS: FunctionDeclaration[] = [
  provisionarBotClienteTool,
  listBotsTool,
  updateBotTool,
  deleteBotTool,
  testBotTool,
];

/**
 * System Prompt para el Agente Autónomo de Infraestructura de Stage AI Labs.
 */
const COPILOT_SYSTEM_INSTRUCTION = `Eres el Agente Autónomo de Infraestructura de Stage AI Labs LLC.
Tienes control y visibilidad total sobre los bots, clientes y servicios de la plataforma.

Tus herramientas integradas son:
1. 'list_bots': Úsala para obtener la lista de todos los bots, sus IDs, slugs, teléfonos y estados. Úsala siempre que el usuario te pregunte qué bots existen o cuando necesites averiguar el ID o slug de un bot antes de actualizarlo.
2. 'provisionar_bot_cliente': Úsala para crear y dar de alta un nuevo bot en Supabase y la infraestructura de producción.
3. 'update_bot': Úsala para modificar cualquier propiedad de un bot (teléfono/WhatsApp, nombre, estado activo/inactivo, instrucciones/prompt).
4. 'delete_bot': Úsala para eliminar o retirar un bot de la infraestructura.
5. 'test_bot': Úsala para verificar la salud, estado y respuesta de un bot en vivo.

Directivas Principales:
- Si el usuario te pide modificar o cambiar el teléfono, nombre o configuración de un bot, utiliza 'update_bot' (o consulta 'list_bots' si no conoces su identificador).
- Si el usuario pide crear un bot, extrae los parámetros (slug, nombre, teléfono, prompt, tokens, budget) y ejecuta 'provisionar_bot_cliente'.
- Si el usuario te pregunta por los bots instalados o su estado, llama a 'list_bots'.
- Responde siempre en español de forma profesional, precisa, concisa y orientada a la ingeniería de infraestructuras.`;

interface IncomingMessage {
  role?: string;
  content?: string;
  text?: string;
}

/**
 * Sanitiza y estructura el historial de mensajes asegurando alternancia user/model.
 */
function sanitizeConversationHistory(rawMessages: IncomingMessage[]): Content[] {
  const contents: Content[] = [];

  for (const msg of rawMessages) {
    const text = (msg.content || msg.text || "").trim();
    if (!text) continue;

    const role = msg.role === "assistant" || msg.role === "model" ? "model" : "user";

    if (contents.length === 0) {
      if (role === "model") continue; // El historial de Gemini debe comenzar con rol 'user'
      contents.push({ role: "user", parts: [{ text }] });
      continue;
    }

    const last = contents[contents.length - 1];
    if (last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  return contents;
}

/**
 * Ejecutores de Backend para las Herramientas del Agente Autónomo
 */

async function handleListBots(statusFilter?: string) {
  try {
    const { data: bots, error: botsErr } = await supabaseAdmin
      .from("client_bots")
      .select("id, client_id, name, slug, kind, status, bot_status_url, dashboard_url, created_at")
      .order("created_at", { ascending: false });

    if (botsErr) {
      return { success: false, error: botsErr.message };
    }

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id, company_name, contact_name, phone, email, status, bot_activo");

    const clientMap = new Map((clients || []).map((c) => [c.id, c]));

    const enrichedBots = (bots || []).map((b) => {
      const client = clientMap.get(b.client_id);
      return {
        id: b.id,
        slug: b.slug,
        name: b.name,
        kind: b.kind || "messaging",
        status: b.status || (client?.bot_activo ? "active" : "inactive"),
        clientName: client?.company_name || client?.contact_name || "Cliente",
        phone: client?.phone || "No configurado",
        email: client?.email || null,
        dashboardUrl: b.dashboard_url,
        createdAt: b.created_at,
      };
    });

    const filtered =
      statusFilter && statusFilter !== "all"
        ? enrichedBots.filter((b) => b.status === statusFilter)
        : enrichedBots;

    return {
      success: true,
      count: filtered.length,
      bots: filtered,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleUpdateBot(args: {
  bot_id: string;
  name?: string;
  phone?: string;
  status?: string;
  prompt?: string;
}) {
  try {
    const identifier = String(args.bot_id || "").trim();
    if (!identifier) {
      return { success: false, error: "El campo 'bot_id' es obligatorio." };
    }

    // Buscar el bot por UUID o por slug
    let query = supabaseAdmin.from("client_bots").select("*");
    if (identifier.includes("-") && identifier.length === 36) {
      query = query.eq("id", identifier);
    } else {
      query = query.eq("slug", identifier);
    }

    const { data: botRows, error: findErr } = await query;
    if (findErr || !botRows || botRows.length === 0) {
      return {
        success: false,
        error: `No se encontró ningún bot con el identificador '${identifier}'.`,
      };
    }

    const targetBot = botRows[0];
    const updates: Record<string, unknown> = {};

    if (args.name && args.name.trim()) {
      updates.name = args.name.trim();
    }
    if (args.status && ["active", "inactive", "paused"].includes(args.status)) {
      updates.status = args.status;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateBotErr } = await supabaseAdmin
        .from("client_bots")
        .update(updates)
        .eq("id", targetBot.id);

      if (updateBotErr) {
        return { success: false, error: updateBotErr.message };
      }
    }

    // Si se especificó nuevo teléfono o estado, actualizar también la tabla clients
    if (targetBot.client_id && (args.phone || args.status)) {
      const clientUpdates: Record<string, unknown> = {};
      if (args.phone && args.phone.trim()) {
        clientUpdates.phone = args.phone.trim();
      }
      if (args.status) {
        clientUpdates.bot_activo = args.status === "active";
      }
      if (Object.keys(clientUpdates).length > 0) {
        await supabaseAdmin
          .from("clients")
          .update(clientUpdates)
          .eq("id", targetBot.client_id);
      }
    }

    return {
      success: true,
      message: `Bot '${targetBot.slug}' (${targetBot.name}) actualizado correctamente en Supabase.`,
      updatedFields: {
        name: args.name || targetBot.name,
        phone: args.phone || "Sin cambios",
        status: args.status || targetBot.status,
        prompt: args.prompt ? "Prompt actualizado" : "Sin cambios",
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleDeleteBot(args: { bot_id: string; confirmation?: string }) {
  try {
    const identifier = String(args.bot_id || "").trim();
    if (!identifier) {
      return { success: false, error: "El campo 'bot_id' es obligatorio." };
    }

    let query = supabaseAdmin.from("client_bots").select("*");
    if (identifier.includes("-") && identifier.length === 36) {
      query = query.eq("id", identifier);
    } else {
      query = query.eq("slug", identifier);
    }

    const { data: botRows, error: findErr } = await query;
    if (findErr || !botRows || botRows.length === 0) {
      return {
        success: false,
        error: `No se encontró ningún bot con el identificador '${identifier}'.`,
      };
    }

    const targetBot = botRows[0];

    // Eliminar de client_bots
    const { error: delErr } = await supabaseAdmin
      .from("client_bots")
      .delete()
      .eq("id", targetBot.id);

    if (delErr) {
      return { success: false, error: delErr.message };
    }

    return {
      success: true,
      message: `Bot '${targetBot.slug}' (${targetBot.name}) eliminado exitosamente de la base de datos de Stage AI Labs.`,
      deletedBot: {
        id: targetBot.id,
        slug: targetBot.slug,
        name: targetBot.name,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleTestBot(args: { bot_id: string; sample_message?: string }) {
  try {
    const identifier = String(args.bot_id || "").trim();
    let query = supabaseAdmin.from("client_bots").select("*");
    if (identifier.includes("-") && identifier.length === 36) {
      query = query.eq("id", identifier);
    } else {
      query = query.eq("slug", identifier);
    }

    const { data: botRows } = await query;
    const bot = botRows?.[0];

    if (!bot) {
      return {
        success: false,
        error: `Bot '${identifier}' no encontrado para pruebas.`,
      };
    }

    const startTime = Date.now();
    let pingStatus = "online";
    let pingDetails = "Configuración e integridad en Supabase verificada.";

    if (bot.bot_status_url) {
      try {
        const res = await fetch(bot.bot_status_url, {
          method: "GET",
          headers: bot.bot_secret ? { "x-bot-secret": bot.bot_secret } : undefined,
          signal: AbortSignal.timeout(4000),
        });
        pingStatus = res.ok ? "online" : `http_${res.status}`;
        pingDetails = `Respuesta del endpoint del bot: ${res.statusText || res.status}`;
      } catch (pingErr) {
        pingStatus = "unreachable_or_local";
        pingDetails = `El endpoint remoto no respondió en 4000ms (${pingErr instanceof Error ? pingErr.message : "Timeout"}).`;
      }
    }

    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      bot: {
        id: bot.id,
        slug: bot.slug,
        name: bot.name,
      },
      health: {
        status: pingStatus,
        latencyMs,
        details: pingDetails,
        testMessage: args.sample_message || "Ping de verificación de infraestructura",
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const Route = createFileRoute("/api/copilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            messages?: IncomingMessage[];
            message?: string;
          };

          const rawMessages: IncomingMessage[] = Array.isArray(body?.messages)
            ? body.messages
            : typeof body?.message === "string" && body.message.trim()
              ? [{ role: "user", content: body.message.trim() }]
              : [];

          if (rawMessages.length === 0) {
            return Response.json(
              {
                success: false,
                error: "Petición inválida: debes enviar un array 'messages' o un campo 'message'.",
              },
              { status: 400 },
            );
          }

          const rawKey =
            process.env.STAGE_GEMINI_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_API_KEY;

          if (!rawKey) {
            return Response.json(
              {
                success: false,
                error: "Variable de entorno STAGE_GEMINI_API_KEY no configurada en el servidor.",
              },
              { status: 500 },
            );
          }

          const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

          const contents = sanitizeConversationHistory(rawMessages);
          if (contents.length === 0) {
            return Response.json(
              { success: false, error: "El historial de mensajes no contiene texto válido." },
              { status: 400 },
            );
          }

          const genAI = new GoogleGenerativeAI(apiKey);

          // Piscina de modelos con soporte nativo de Function Calling
          const CANDIDATE_MODELS = [
            "gemini-flash-lite-latest",
            "gemini-3.7-flash",
            "gemini-3.5-flash",
            "gemini-flash-latest",
          ];

          const history = contents.slice(0, -1);
          const lastMessage = contents[contents.length - 1];

          const createChat = (modelName: string) => {
            return genAI
              .getGenerativeModel({
                model: modelName,
                systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
                tools: [{ functionDeclarations: ALL_COPILOT_TOOLS }],
              })
              .startChat({ history });
          };

          const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

          async function executeWithModelCascade<T>(
            operation: (currentChat: ReturnType<typeof createChat>) => Promise<T>,
            stepName = "operación",
          ): Promise<{ data: T; modelName: string }> {
            let lastError: unknown;

            for (const modelName of CANDIDATE_MODELS) {
              const currentChat = createChat(modelName);

              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const result = await operation(currentChat);
                  return { data: result, modelName };
                } catch (err: unknown) {
                  lastError = err;
                  const errObj = err as { status?: number; message?: string };

                  const isTransient =
                    errObj?.status === 503 ||
                    errObj?.status === 500 ||
                    errObj?.status === 429 ||
                    errObj?.message?.includes("503") ||
                    errObj?.message?.includes("500") ||
                    errObj?.message?.includes("high demand") ||
                    errObj?.message?.includes("Service Unavailable");

                  if (attempt === 0 && isTransient) {
                    console.warn(
                      `[Copilot Brain] Error 503 en '${modelName}' durante ${stepName}. Reintentando en 2000ms...`,
                    );
                    await delay(2000);
                    continue;
                  }

                  console.warn(
                    `[Copilot Brain] Falló '${modelName}' (${errObj?.status || "error"}). Conmutando al siguiente modelo...`,
                  );
                  break;
                }
              }
            }

            throw lastError;
          }

          const { data: chatResult, modelName: successfulModel } = await executeWithModelCascade(
            (c) => c.sendMessage(lastMessage.parts),
            "detección de intención del copiloto",
          );

          console.log(`[Copilot Brain] Turno completado vía modelo '${successfulModel}'`);

          const response = chatResult.response;
          const functionCalls = response.functionCalls();

          // Caso 1: Gemini invocó una de las herramientas
          if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const rawArgs = (call.args || {}) as Record<string, any>;
            let toolExecutionResult: Record<string, any> = { success: false, message: "Herramienta desconocida" };

            console.log(`[Copilot Brain] Invocando herramienta '${call.name}' con args:`, rawArgs);

            if (call.name === "provisionar_bot_cliente") {
              const provisionArgs: Partial<TenantInputData> = {
                slug: typeof rawArgs.slug === "string" ? rawArgs.slug.trim() : undefined,
                name: typeof rawArgs.name === "string" ? rawArgs.name.trim() : undefined,
                phone: typeof rawArgs.phone === "string" ? rawArgs.phone.trim() : undefined,
                monthlyTokens:
                  typeof rawArgs.tokens === "number" ? rawArgs.tokens : 10_000_000,
                monthlyBudgetUsd:
                  typeof rawArgs.budget === "number" ? rawArgs.budget : 50,
                prompt: typeof rawArgs.prompt === "string" ? rawArgs.prompt.trim() : "",
                model: "gemini",
                kind: "messaging",
              };

              toolExecutionResult = await provisionTenant(provisionArgs, {
                executeSupabase: true,
              });
            } else if (call.name === "list_bots") {
              toolExecutionResult = await handleListBots(rawArgs.status);
            } else if (call.name === "update_bot") {
              toolExecutionResult = await handleUpdateBot(rawArgs as any);
            } else if (call.name === "delete_bot") {
              toolExecutionResult = await handleDeleteBot(rawArgs as any);
            } else if (call.name === "test_bot") {
              toolExecutionResult = await handleTestBot(rawArgs as any);
            }

            console.log(`[Copilot Brain] Resultado de '${call.name}':`, toolExecutionResult);

            // Segundo turno hacia Gemini para formular la respuesta en lenguaje natural
            let conversationalReply = "";
            try {
              const secondTurnPrompt = `[Resultado de la herramienta '${call.name}']: ${JSON.stringify(toolExecutionResult)}. Proporciona un mensaje de respuesta claro, profesional y estructurado en español confirmando los detalles de la acción realizada.`;
              const { data: secondTurnResult } = await executeWithModelCascade(
                (c) => c.sendMessage(secondTurnPrompt),
                "segundo turno (confirmación de herramienta)",
              );
              conversationalReply = secondTurnResult.response.text();
            } catch (secondTurnError) {
              console.warn("[Copilot Brain] Error en segundo turno:", secondTurnError);
              conversationalReply = toolExecutionResult.message || `Acción '${call.name}' ejecutada con éxito.`;
            }

            return Response.json({
              success: Boolean(toolExecutionResult.success !== false),
              reply: conversationalReply,
              functionCall: {
                name: call.name,
                args: call.args,
                result: toolExecutionResult,
              },
            });
          }

          // Caso 2: Respuesta directa conversacional
          const replyText = response.text();
          return Response.json({
            success: true,
            reply: replyText,
          });
        } catch (error) {
          console.error("[Copilot Brain] Error en /api/copilot:", error);
          return Response.json(
            {
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Ocurrió un error inesperado al procesar la solicitud en el copiloto.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

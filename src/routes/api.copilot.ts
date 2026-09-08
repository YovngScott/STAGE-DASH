import { createFileRoute } from "@tanstack/react-router";
import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  SchemaType,
  type Content,
} from "@google/generative-ai";
import { provisionTenant, type TenantInputData } from "../../scripts/onboard-tenant.ts";

/**
 * Esquema de la herramienta Function Calling para Gemini 1.5 Flash.
 * Define la herramienta 'provisionar_bot_cliente' con los parámetros requeridos.
 */
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

/**
 * System Prompt para el Copiloto de Infraestructura de Stage AI Labs.
 */
const COPILOT_SYSTEM_INSTRUCTION = `Eres el Copiloto de Infraestructura de Stage AI Labs.
Tu único trabajo es abstraer la intención del usuario a partir del historial de conversación y utilizar la herramienta 'provisionar_bot_cliente' para crear y aprovisionar bots de clientes en la infraestructura de Stage AI Labs.

Directivas Principales:
1. Detección de Intención: Si el usuario te indica los datos de un negocio o expresa el deseo de crear, aprovisionar o dar de alta un bot o cliente, extrae los parámetros y llama inmediatamente a 'provisionar_bot_cliente'.
2. Inferencia Inteligente:
   - Si no se especifica un 'slug' explícito, deriva uno limpio y URL-safe a partir del nombre comercial (ej. 'Clínica Dental Sonrisas' -> 'clinica-dental-sonrisas').
   - Si el teléfono no tiene el signo '+', pero incluye código de área de República Dominicana (809/829/849) u otro país, normalízalo al formato E.164 (ej. '+18095550199').
   - Si no se especifica el límite de tokens, asigna 10000000 (10 millones).
   - Si no se especifica el presupuesto, asigna 50 (USD).
   - Si no se proporciona un prompt detallado, redacta uno conciso de alta calidad resumiendo el negocio y sus reglas de atención.
3. Preguntas Aclaratorias: Si los datos mínimos imprescindibles (como el nombre del negocio o el contacto) están completamente ausentes, realiza preguntas breves y directas al usuario para obtenerlos antes de llamar a la herramienta.
4. Confirmación al Usuario: Tras la ejecución de 'provisionar_bot_cliente', confirma en español que el bot/tenant ha sido creado y aprovisionado exitosamente en Stage AI Labs, destacando el slug, nombre, teléfono y límites operativos asignados.`;

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

          // Piscina de modelos resistentes y activos en v1beta:
          // 1. 'gemini-flash-lite-latest': alta capacidad, latencia ultra baja, sin colas de saturación 503
          // 2. 'gemini-3.7-flash' / 'gemini-3.5-flash': modelos avanzados con function calling probado
          // 3. 'gemini-flash-latest': fallback adicional
          const CANDIDATE_MODELS = [
            "gemini-flash-lite-latest",
            "gemini-3.7-flash",
            "gemini-3.5-flash",
            "gemini-flash-latest",
          ];

          // Historial previo y último mensaje del usuario
          const history = contents.slice(0, -1);
          const lastMessage = contents[contents.length - 1];

          const createChat = (modelName: string) => {
            return genAI
              .getGenerativeModel({
                model: modelName,
                systemInstruction: COPILOT_SYSTEM_INSTRUCTION,
                tools: [{ functionDeclarations: [provisionarBotClienteTool] }],
              })
              .startChat({ history });
          };

          const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

          /**
           * Ejecuta una operación contra Gemini recorriendo la piscina de modelos y reintentando
           * ante errores transitorios de alta demanda (503 Service Unavailable / 429).
           */
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
                      `[Copilot Brain] Error 503 (alta demanda) en '${modelName}' durante ${stepName}. Reintentando en 2000ms...`,
                    );
                    await delay(2000);
                    continue;
                  }

                  console.warn(
                    `[Copilot Brain] Falló '${modelName}' (${errObj?.status || "error"}). Conmutando al siguiente modelo en la piscina...`,
                  );
                  break; // Salta al siguiente modelo candidato
                }
              }
            }

            throw lastError;
          }

          const { data: chatResult, modelName: successfulModel } = await executeWithModelCascade(
            (c) => c.sendMessage(lastMessage.parts),
            "primer turno (detección de intención)",
          );

          console.log(`[Copilot Brain] Turno completado con éxito vía modelo '${successfulModel}'`);

          const response = chatResult.response;
          const functionCalls = response.functionCalls();

          // Caso 1: Gemini detectó la intención y ejecutó el Function Call
          if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];

            if (call.name === "provisionar_bot_cliente") {
              const rawArgs = (call.args || {}) as Record<string, unknown>;

              const provisionArgs: Partial<TenantInputData> = {
                slug: typeof rawArgs.slug === "string" ? rawArgs.slug.trim() : undefined,
                name: typeof rawArgs.name === "string" ? rawArgs.name.trim() : undefined,
                phone: typeof rawArgs.phone === "string" ? rawArgs.phone.trim() : undefined,
                monthlyTokens: typeof rawArgs.tokens === "number" ? rawArgs.tokens : 10_000_000,
                monthlyBudgetUsd: typeof rawArgs.budget === "number" ? rawArgs.budget : 50,
                prompt: typeof rawArgs.prompt === "string" ? rawArgs.prompt.trim() : "",
                model: "gemini",
                kind: "messaging",
              };

              console.log(
                "[Copilot Brain] Invocando provisionTenant con argumentos:",
                provisionArgs,
              );

              // Ejecutar la lógica de scripts/onboard-tenant.ts
              const provisionResult = await provisionTenant(provisionArgs, {
                executeSupabase: true,
              });

              console.log(
                "[Copilot Brain] Resultado del aprovisionamiento:",
                provisionResult.message,
              );

              // Segundo turno hacia Gemini para generar la confirmación contextualizada con reintento
              let conversationalReply = "";
              try {
                const secondTurnPrompt = `[Resultado de la herramienta 'provisionar_bot_cliente']: ${provisionResult.message}. Proporciona un mensaje de confirmación claro, conciso y profesional al usuario indicando el slug, la empresa y que el bot ha sido aprovisionado exitosamente.`;
                const { data: secondTurnResult } = await executeWithModelCascade(
                  (c) => c.sendMessage(secondTurnPrompt),
                  "segundo turno (confirmación)",
                );
                conversationalReply = secondTurnResult.response.text();
              } catch (secondTurnError) {
                console.warn("[Copilot Brain] Error en segundo turno de Gemini:", secondTurnError);
                conversationalReply = provisionResult.success
                  ? `Tenant '${provisionResult.normalized?.slug || provisionArgs.slug}' (${provisionResult.data?.name || "Empresa"}) creado y aprovisionado exitosamente en Stage AI Labs.`
                  : `No se pudo completar el aprovisionamiento: ${provisionResult.message}`;
              }

              return Response.json({
                success: provisionResult.success,
                reply: conversationalReply,
                functionCall: {
                  name: "provisionar_bot_cliente",
                  args: call.args,
                  result: provisionResult,
                },
              });
            }
          }

          // Caso 2: El modelo respondió con texto conversacional (ej. solicitando más datos)
          const replyText = response.text();
          return Response.json({
            success: true,
            reply: replyText,
          });
        } catch (error) {
          console.error("[Copilot Brain] Error inesperado en /api/copilot:", error);
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

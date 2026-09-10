import { createFileRoute } from "@tanstack/react-router";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export const Route = createFileRoute("/api/magic-onboard")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            url?: string;
            textData?: string;
          };
          const url = typeof body?.url === "string" ? body.url.trim() : "";
          const textData = typeof body?.textData === "string" ? body.textData.trim() : "";

          if (!url && !textData) {
            return Response.json(
              { error: "Debes proporcionar un campo 'url' o 'textData'." },
              { status: 400 },
            );
          }

          let rawContent = textData;

          if (url) {
            let validUrl: URL;
            try {
              validUrl = new URL(
                url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`,
              );
            } catch {
              return Response.json(
                { error: "La URL proporcionada no tiene un formato válido." },
                { status: 400 },
              );
            }

            try {
              const res = await fetch(validUrl.toString(), {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                signal: AbortSignal.timeout(10000),
              });

              if (!res.ok) {
                return Response.json(
                  {
                    error: `No se pudo acceder a la página web (HTTP ${res.status}: ${res.statusText}).`,
                  },
                  { status: 422 },
                );
              }

              const html = await res.text();
              // Limpieza básica de scripts, estilos y markup HTML
              const cleanedText = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
                .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
                .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/&quot;/gi, '"')
                .replace(/\s+/g, " ")
                .trim();

              rawContent = (rawContent ? rawContent + "\n\n" : "") + cleanedText.slice(0, 20000);
            } catch (fetchErr) {
              return Response.json(
                {
                  error: `Error al consultar la URL: ${
                    fetchErr instanceof Error
                      ? fetchErr.message
                      : "Tiempo de espera agotado o conexión rechazada."
                  }`,
                },
                { status: 422 },
              );
            }
          }

          if (!rawContent || rawContent.length < 10) {
            return Response.json(
              { error: "No se pudo extraer contenido suficiente de la página web." },
              { status: 422 },
            );
          }

          const apiKey =
            process.env.STAGE_GEMINI_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_API_KEY;

          if (!apiKey) {
            return Response.json(
              {
                error:
                  "Falta configurar la clave STAGE_GEMINI_API_KEY en las variables de entorno del servidor.",
              },
              { status: 500 },
            );
          }

          const genAI = new GoogleGenerativeAI(apiKey);
          const CANDIDATE_MODELS = [
            process.env.STAGE_GEMINI_MODEL,
            "gemini-flash-lite-latest",
            "gemini-flash-latest",
            "gemini-3.6-flash",
            "gemini-3.8-flash",
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash",
          ].filter(Boolean) as string[];

          const instructionPrompt = `Analiza la siguiente información de una empresa o sitio web y extrae los datos clave para configurar su bot de atención y automatización de clientes:

--- CONTENIDO DEL NEGOCIO ---
${rawContent}
--- FIN CONTENIDO ---

Instrucciones:
1. "name": Extrae el nombre real y limpio de la empresa.
2. "phone": Extrae el número de WhatsApp o contacto. Debe ser formato E.164 (ej. +18091234567). Si no tiene código de país y parece dominicano, antepón +1. Si no hay teléfono, usa "+18090000000".
3. "prompt": Redacta en un máximo de 3 líneas el resumen operativo: qué hace la empresa, qué problemas resuelve y la regla principal de atención del bot.
4. "businessHours": Extrae el horario de atención o asigna "Lunes a viernes de 9:00 AM a 6:00 PM" si no se especifica.
5. "services": Extrae entre 2 y 8 servicios o productos principales ofrecidos.`;

          let responseText = "";
          let lastModelError: any = null;

          for (const modelName of CANDIDATE_MODELS) {
            try {
              const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                      name: {
                        type: SchemaType.STRING,
                        description: "Nombre oficial o comercial del negocio o empresa.",
                      },
                      phone: {
                        type: SchemaType.STRING,
                        description:
                          "Número de teléfono o WhatsApp principal en formato internacional E.164 (ej. +18095551234). Si no se encuentra, usa '+18090000000'.",
                      },
                      prompt: {
                        type: SchemaType.STRING,
                        description:
                          "Resumen conciso del negocio, reglas de atención, productos y políticas operativas clave (máximo 3 líneas).",
                      },
                      businessHours: {
                        type: SchemaType.STRING,
                        description:
                          "Horario de atención al público (ej. Lunes a viernes de 9:00 AM a 6:00 PM).",
                      },
                      services: {
                        type: SchemaType.ARRAY,
                        items: {
                          type: SchemaType.STRING,
                        },
                        description: "Lista de servicios o productos principales identificados.",
                      },
                    },
                    required: ["name", "phone", "prompt", "businessHours", "services"],
                  },
                },
              });

              const result = await model.generateContent(instructionPrompt);
              responseText = result.response.text();
              if (responseText) break;
            } catch (err: any) {
              lastModelError = err;
              console.warn(`[magic-onboard] Fallo en modelo ${modelName}: ${err?.message}, probando siguiente...`);
            }
          }

          if (!responseText) {
            throw new Error(lastModelError?.message || "No se pudo generar el contenido con los modelos de Gemini.");
          }

          let parsedData: {
            name: string;
            phone: string;
            prompt: string;
            businessHours: string;
            services: string[];
          };

          try {
            parsedData = JSON.parse(responseText);
          } catch {
            return Response.json(
              { error: "La IA generó una respuesta que no pudo ser procesada como JSON." },
              { status: 502 },
            );
          }

          // Generar slug sugerido
          const slug =
            (parsedData.name || "empresa")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40) || "nuevo-bot";

          return Response.json({
            success: true,
            data: {
              name: parsedData.name || "",
              slug,
              phone: parsedData.phone || "",
              prompt: parsedData.prompt || "",
              businessHours: parsedData.businessHours || "Lunes a viernes de 9:00 AM a 6:00 PM",
              services: Array.isArray(parsedData.services) ? parsedData.services : [],
            },
          });
        } catch (error) {
          console.error("[api.magic-onboard] Error inesperado:", error);
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Ocurrió un error inesperado al escanear el negocio.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

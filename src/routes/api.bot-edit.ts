import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redeployBotConfig, type BotKind, type TenantConfigDraft } from "@/lib/provisioning";
import { composeTenantPrompt, normalizeBotBehavior } from "@/lib/bot-prompts";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";

export const Route = createFileRoute("/api/bot-edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: user, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user.user) return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: owner } = await supabase.rpc("has_role", { _user_id: user.user.id, _role: "owner" });
        if (!owner) return Response.json({ error: "No autorizado." }, { status: 401 });

        const body = await request.json().catch(() => null) as { botId?: string; name?: string; promptExtra?: string } | null;
        if (!body?.botId) return Response.json({ error: "Falta botId." }, { status: 400 });
        const { data: bot, error: botError } = await supabaseAdmin
          .from("client_bots")
          .select("id,name,slug,kind,bot_status_url")
          .eq("id", body.botId)
          .maybeSingle();
        if (botError) return Response.json({ error: botError.message }, { status: 500 });
        if (!bot) return Response.json({ error: "Bot no encontrado." }, { status: 404 });

        const name = String(body.name ?? "").trim();
        const promptExtra = String(body.promptExtra ?? "").trim();
        if (!name) return Response.json({ error: "El nombre del bot es obligatorio." }, { status: 400 });
        // GitHub mantiene la configuración canónica. Algunas instalaciones
        // antiguas todavía no tienen la columna prompt_extra en Supabase.
        const { error: dbError } = await supabaseAdmin.from("client_bots").update({ name }).eq("id", bot.id);
        if (dbError) return Response.json({ error: dbError.message }, { status: 500 });

        const githubToken = process.env.STAGE_GITHUB_TOKEN;
        if (!githubToken) return Response.json({ error: "Falta STAGE_GITHUB_TOKEN en .env.local." }, { status: 500 });
        const [ownerName, repoName] = (process.env.STAGE_BOT_TEMPLATE_REPO || DEFAULT_REPO).split("/");
        const path = `backend/config/tenants/${bot.slug}.json`;
        const base = `https://api.github.com/repos/${ownerName}/${repoName}/contents/${path}`;
        const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${githubToken}`, "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "stage-ai-labs-owner-console" };
        const existing = await fetch(`${base}?ref=main`, { headers });
        if (!existing.ok) return Response.json({ error: `GitHub no encontró el tenant (${existing.status}).` }, { status: 502 });
        const file = await existing.json();
        const config = JSON.parse(Buffer.from(String(file.content ?? ""), "base64").toString("utf8"));
        config.nombreBot = name;
        // Keep the server-owned behavior and security protocol intact when an
        // owner changes the visible extra instructions later.
        config.behavior = normalizeBotBehavior(config.behavior);
        config.extraInstructions = promptExtra;
        config.promptExtra = composeTenantPrompt({
          behavior: config.behavior,
          companyInfo: String(config.companyInfo ?? ""),
          extraInstructions: promptExtra,
        });
        const saved = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ message: `Actualizar bot ${name}`, content: Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8").toString("base64"), branch: "main", sha: file.sha }) });
        const payload = await saved.json().catch(() => null);
        if (!saved.ok) return Response.json({ error: payload?.message ?? `GitHub respondió ${saved.status}.` }, { status: 502 });
        const appName = appNameFromStatusUrl(bot.bot_status_url);
        if (!appName) return Response.json({ error: "El bot no tiene una URL de Fly válida para aplicar el cambio." }, { status: 400 });
        try {
          await redeployBotConfig({
            appName,
            slug: bot.slug,
            kind: (bot.kind ?? "messaging") as BotKind,
            tenantConfig: config as TenantConfigDraft,
          });
        } catch (error) {
          return Response.json({
            error: `El cambio quedó guardado en GitHub, pero no se pudo desplegar en Fly: ${error instanceof Error ? error.message : "error desconocido"}`,
            commitUrl: payload?.commit?.html_url ?? null,
          }, { status: 502 });
        }
        return Response.json({ ok: true, commitUrl: payload?.commit?.html_url ?? null });
      },
    },
  },
});

function appNameFromStatusUrl(value: string | null | undefined) {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    if (!host.endsWith(".fly.dev")) return null;
    const appName = host.slice(0, -".fly.dev".length);
    return /^[a-z0-9][a-z0-9-]{0,62}$/.test(appName) ? appName : null;
  } catch {
    return null;
  }
}

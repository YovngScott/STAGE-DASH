import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
          .select("id,name,slug")
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
        config.promptExtra = promptExtra;
        const saved = await fetch(base, { method: "PUT", headers, body: JSON.stringify({ message: `Actualizar bot ${name}`, content: Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8").toString("base64"), branch: "main", sha: file.sha }) });
        const payload = await saved.json().catch(() => null);
        if (!saved.ok) return Response.json({ error: payload?.message ?? `GitHub respondió ${saved.status}.` }, { status: 502 });
        return Response.json({ ok: true, commitUrl: payload?.commit?.html_url ?? null });
      },
    },
  },
});

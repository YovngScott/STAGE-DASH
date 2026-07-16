import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_REPO = "YovngScott/Stage-Bot-Template";
const DEFAULT_BRANCH = "main";
const BACKEND_URL = "https://wiltech-bot.fly.dev";
const LOCAL_CLIENT_DASHBOARD_URL = "http://127.0.0.1:5174/";

type BotType = "assistant" | "messaging" | "voice";

interface BotBuilderRequest {
  clientId?: string;
  productName?: string;
  botType?: BotType;
  tenant: {
    slug?: string;
    nombre?: string;
    nombreBot?: string;
    descripcion?: string;
    direccion?: string;
    horario?: string;
    contacto?: string;
    moneda?: string;
    zonaHoraria?: string;
    adminEmails?: string[];
    servicios?: string[];
    promptExtra?: string;
    googleCalendarId?: string;
  };
  catalog?: Array<{
    nombre: string;
    categoria: string;
    descripcion: string;
    precio: number;
  }>;
  updateClient?: boolean;
}

export const Route = createFileRoute("/api/bot-builder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }

        let body: BotBuilderRequest;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Body invalido." }, { status: 400 });
        }

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }
        const { data: isOwner } = await supabase.rpc("has_role", {
          _user_id: userData.user.id,
          _role: "owner",
        });
        if (!isOwner) {
          return Response.json({ error: "No autorizado." }, { status: 401 });
        }

        const clientId = String(body.clientId ?? "");
        if (!clientId) {
          return Response.json({ error: "Debes elegir un cliente existente." }, { status: 400 });
        }
        if (!process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY) {
          return Response.json(
            { error: "Falta STAGE_SUPABASE_SERVICE_ROLE_KEY en tu entorno local. Agrega esta variable a .env.local y reinicia http://127.0.0.1:5173/." },
            { status: 500 },
          );
        }

        const { data: client, error: clientError } = await supabaseAdmin
          .from("clients")
          .select("id,company_name,email,phone,services")
          .eq("id", clientId)
          .maybeSingle();
        if (clientError) {
          return Response.json({ error: clientError.message }, { status: 500 });
        }
        if (!client) {
          return Response.json({ error: "Cliente no encontrado." }, { status: 404 });
        }

        const slug = sanitizeSlug(body.tenant.slug || client.company_name);
        if (!slug) {
          return Response.json({ error: "No se pudo generar un slug valido." }, { status: 400 });
        }

        const adminEmails = normalizeEmails(body.tenant.adminEmails);
        if (adminEmails.length === 0 && client.email) adminEmails.push(client.email);
        if (adminEmails.length === 0) {
          return Response.json(
            { error: "El bot necesita al menos un correo admin para el dashboard del cliente." },
            { status: 400 },
          );
        }

        const tenantConfig = {
          slug,
          nombreBot: body.tenant.nombreBot?.trim() || `${client.company_name} Bot`,
          nombre: body.tenant.nombre?.trim() || client.company_name,
          descripcion: body.tenant.descripcion?.trim() || "Bot de ventas y atencion al cliente.",
          direccion: body.tenant.direccion?.trim() || "Atencion por WhatsApp",
          horario: body.tenant.horario?.trim() || "Lunes a viernes de 9:00 AM a 6:00 PM",
          contacto: body.tenant.contacto?.trim() || client.phone || "",
          redes: {},
          servicios: body.tenant.servicios ?? [],
          moneda: body.tenant.moneda?.trim() || "USD",
          zonaHoraria: body.tenant.zonaHoraria?.trim() || "America/Santo_Domingo",
          adminEmails,
          promptExtra: body.tenant.promptExtra?.trim() || "",
          googleCalendarId: body.tenant.googleCalendarId?.trim() || "primary",
        };

        const githubToken = process.env.STAGE_GITHUB_TOKEN;
        if (!githubToken) {
          return Response.json(
            { error: "Falta STAGE_GITHUB_TOKEN en tu entorno local para poder guardar el tenant en GitHub." },
            { status: 500 },
          );
        }

        const repo = process.env.STAGE_BOT_TEMPLATE_REPO || DEFAULT_REPO;
        const branch = process.env.STAGE_BOT_TEMPLATE_BRANCH || DEFAULT_BRANCH;
        const [owner, name] = repo.split("/");
        if (!owner || !name) {
          return Response.json(
            { error: "STAGE_BOT_TEMPLATE_REPO debe tener formato owner/repo." },
            { status: 500 },
          );
        }

        const tenantPath = `backend/config/tenants/${slug}.json`;
        const json = `${JSON.stringify(tenantConfig, null, 2)}\n`;

        const createdFile = await putGithubFile({
          owner,
          repo: name,
          path: tenantPath,
          branch,
          token: githubToken,
          content: json,
          message: `Agregar tenant ${tenantConfig.nombre}`,
        });
        if (!createdFile.ok) {
          return Response.json({ error: createdFile.error }, { status: createdFile.status });
        }

        const botStatusUrl = `${BACKEND_URL}/api/${slug}/config/bot-activo`;
        const dashboardName = `${tenantConfig.nombre} Dashboard`;
        const dashboardUrl = process.env.STAGE_LOCAL_CLIENT_DASHBOARD_URL || LOCAL_CLIENT_DASHBOARD_URL;
        let botResourceId: string | null = null;

        if (body.updateClient) {
          const currentServices = Array.isArray(client.services) ? client.services : [];
          const nextServices = body.productName && !currentServices.includes(body.productName)
            ? [...currentServices, body.productName]
            : currentServices;
          await supabaseAdmin
            .from("clients")
            .update({
              services: nextServices,
              bot_status_url: botStatusUrl,
              bot_secret: process.env.STAGE_PLATFORM_ADMIN_SECRET || undefined,
              bot_activo: true,
            })
            .eq("id", clientId);

          const botInsert = await supabaseAdmin
            .from("client_bots")
            .upsert(
              {
                client_id: clientId,
                name: tenantConfig.nombreBot,
                slug,
                kind: body.botType ?? "messaging",
                product_name: body.productName ?? null,
                status: "active",
                bot_status_url: botStatusUrl,
                bot_secret: process.env.STAGE_PLATFORM_ADMIN_SECRET || null,
                dashboard_url: dashboardUrl,
                github_commit_url: createdFile.commitUrl,
              },
              { onConflict: "slug" },
            )
            .select("id")
            .maybeSingle();
          if (!botInsert.error) botResourceId = botInsert.data?.id ?? null;

          await supabaseAdmin.from("client_dashboards").insert({
            client_id: clientId,
            bot_id: botResourceId,
            name: dashboardName,
            slug,
            url: dashboardUrl,
            provider: "local",
            status: "local",
          });
        }

        return Response.json({
          ok: true,
          slug,
          tenantPath,
          commitUrl: createdFile.commitUrl,
          // El commit en backend/config/tenants dispara .github/workflows/
          // deploy-backend.yml, que redespliega Fly automáticamente.
          deployTriggered: true,
          botStatusUrl,
          dashboardUrl,
          catalogSql: buildCatalogSql(slug, tenantConfig.moneda, body.catalog ?? []),
          adminSql: `insert into tenant_admins (user_id, tenant_id)\nselect 'EL_USER_UID'::uuid, id from tenants where slug = '${slug}';`,
        });
      },
    },
  },
});

async function putGithubFile(args: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
  content: string;
  message: string;
}): Promise<{ ok: true; commitUrl: string | null } | { ok: false; error: string; status: number }> {
  const base = `https://api.github.com/repos/${args.owner}/${args.repo}/contents/${args.path}`;
  const existingRes = await fetch(`${base}?ref=${encodeURIComponent(args.branch)}`, {
    headers: githubHeaders(args.token),
  });
  let sha: string | undefined;
  if (existingRes.ok) {
    const existing = await existingRes.json();
    sha = typeof existing.sha === "string" ? existing.sha : undefined;
  } else if (existingRes.status !== 404) {
    return {
      ok: false,
      status: existingRes.status,
      error: `GitHub no pudo revisar si el archivo existe (${existingRes.status}).`,
    };
  }

  const res = await fetch(base, {
    method: "PUT",
    headers: githubHeaders(args.token),
    body: JSON.stringify({
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: args.branch,
      sha,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.message ?? `GitHub respondio ${res.status}.`,
    };
  }
  return { ok: true, commitUrl: payload?.commit?.html_url ?? null };
}

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "stage-ai-labs-owner-console",
  };
}

function sanitizeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeEmails(value?: string[]) {
  return Array.from(
    new Set(
      (value ?? [])
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    ),
  );
}

function sql(value: string) {
  return value.replace(/'/g, "''");
}

function buildCatalogSql(
  slug: string,
  moneda: string,
  catalog: Array<{ nombre: string; categoria: string; descripcion: string; precio: number }>,
) {
  const rows = catalog
    .filter((item) => item.nombre.trim())
    .map(
      (item) =>
        `('${sql(item.nombre)}','${sql(item.categoria || "General")}','${sql(item.descripcion || "")}',${Number(item.precio) || 0})`,
    );
  if (rows.length === 0) return "";
  return `insert into servicios (tenant_id, nombre, categoria, descripcion, precio, moneda, disponible)\nselect (select id from tenants where slug = '${sql(slug)}'), d.nombre, d.categoria, d.descripcion, d.precio, '${sql(moneda)}', true\nfrom (values\n  ${rows.join(",\n  ")}\n) as d(nombre,categoria,descripcion,precio)\nwhere not exists (\n  select 1 from servicios s\n  where s.tenant_id = (select id from tenants where slug = '${sql(slug)}')\n    and lower(s.nombre) = lower(d.nombre)\n);`;
}

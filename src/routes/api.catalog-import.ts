import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractPrices } from "@/lib/catalog/document-extract.server";
import { toServicio } from "@/lib/catalog/catalog-migration";

export const Route = createFileRoute("/api/catalog-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const { data: user } = await supabaseAdmin.auth.getUser(token);
        if (!user.user) return Response.json({ error: "No autorizado." }, { status: 401 });
        const { data: owner } = await supabaseAdmin.rpc("has_role", {
          _user_id: user.user.id,
          _role: "owner",
        });
        if (!owner) return Response.json({ error: "No autorizado." }, { status: 403 });
        const form = await request.formData();
        const tenantId = String(form.get("tenantId") ?? "");
        const file = form.get("file");
        if (!(file instanceof File))
          return Response.json({ error: "Falta el documento." }, { status: 400 });
        try {
          const extracted = await extractPrices(
            tenantId,
            Buffer.from(await file.arrayBuffer()),
            file.type,
            {
              apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
              model: process.env.CATALOG_EXTRACTION_MODEL ?? "gemini-2.5-flash",
            },
          );
          const rows = extracted.rows
            .filter((r) => r.tipo_pieza && r.dispositivo && r.precio !== null && r.moneda)
            .map((r) =>
              toServicio({
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                tipo_pieza: r.tipo_pieza,
                dispositivo: r.dispositivo,
                calidad: r.calidad ?? "generica",
                precio: r.precio,
                moneda: r.moneda,
                stock: 0,
                descripcion: r.evidencia,
              }),
            );
          return Response.json({ ...extracted, rows });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "No se pudo extraer el catálogo." },
            { status: 422 },
          );
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOwner } from "@/lib/auth-owner.server";

export const Route = createFileRoute("/api/catalog-stock")({
  server: { handlers: { PATCH: async ({ request }) => {
    const denied = await authorizeOwner(request);
    if (denied) return denied;
    const body = await request.json().catch(() => null) as { tenantId?: string; serviceId?: string; stock?: number; precio?: number } | null;
    if (!body?.tenantId || !body.serviceId || (body.stock === undefined && body.precio === undefined)) return Response.json({ error: "tenantId, serviceId y stock o precio son obligatorios." }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(body.tenantId) || !/^[0-9a-f-]{36}$/i.test(body.serviceId)) return Response.json({ error: "Identificadores inválidos." }, { status: 400 });
    const patch: { stock?: number; precio?: number; actualizado_en: string } = { actualizado_en: new Date().toISOString() };
    if (body.stock !== undefined) { if (!Number.isSafeInteger(body.stock) || body.stock < 0) return Response.json({ error: "Stock inválido." }, { status: 400 }); patch.stock = body.stock; }
    if (body.precio !== undefined) { if (!Number.isFinite(body.precio) || body.precio < 0) return Response.json({ error: "Precio inválido." }, { status: 400 }); patch.precio = body.precio; }
    const { data, error } = await supabaseAdmin.from("servicios").update(patch).eq("id", body.serviceId).eq("tenant_id", body.tenantId).select("id,tenant_id,nombre,precio,moneda,stock,actualizado_en").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Servicio inexistente o fuera del tenant." }, { status: 404 });
    return Response.json({ service: data });
  } } },
});

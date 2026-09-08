import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const KNOWN_OWNER_EMAILS = [
  "stage.labs@hotmail.com",
  "itssilverio032008@gmail.com",
  "josephsilverio9498@gmail.com",
];

/**
 * Valida de forma integral si la petición proviene de un dueño / administrador
 * de Stage AI Labs. Aplica múltiples capas de verificación:
 * 1. Validación de Bearer token con Supabase Auth
 * 2. Whitelist de emails de administradores de Stage AI Labs
 * 3. Verificación directa en la tabla 'user_roles' usando supabaseAdmin (service_role)
 * 4. Verificación mediante RPC 'has_role'
 */
export async function authorizeOwner(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return Response.json({ error: "No autorizado. Token de sesión no proporcionado." }, { status: 401 });
  }

  // 1. Obtener usuario autenticado en Supabase Auth
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "No autorizado. Sesión inválida o expirada." }, { status: 401 });
  }

  const user = userData.user;
  const email = (user.email ?? "").toLowerCase().trim();

  // 2. Validación por whitelist de emails oficiales
  if (email && KNOWN_OWNER_EMAILS.includes(email)) {
    return null; // Autorizado
  }

  // 3. Validación directa en tabla user_roles usando supabaseAdmin (bypasea RLS)
  try {
    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();

    if (!roleError && roleRow?.role === "owner") {
      return null; // Autorizado
    }
  } catch (err) {
    console.error("[authorizeOwner] Error al consultar user_roles:", err);
  }

  // 4. Validación mediante RPC has_role
  try {
    const { data: isOwner } = await supabaseAdmin.rpc("has_role", {
      _user_id: user.id,
      _role: "owner",
    });

    if (isOwner === true) {
      return null; // Autorizado
    }
  } catch (err) {
    console.error("[authorizeOwner] Error al invocar has_role RPC:", err);
  }

  return Response.json({ error: "No autorizado. Tu cuenta no posee permisos de dueño." }, { status: 401 });
}

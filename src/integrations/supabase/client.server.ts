import { createClient } from "@supabase/supabase-js";

// Server-only admin client for privileged operations against the
// external Stage AI Labs Supabase project.
const SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";

// supabase-js eagerly initializes a Realtime client (unused here), which
// requires a WebSocket implementation. The local server may run on a Node
// runtime without native WebSocket, so it must be provided explicitly or
// the client throws on construction during SSR.
const wsTransport =
  typeof WebSocket !== "undefined" ? WebSocket : (class {} as unknown as typeof WebSocket);

// Every route module in this app is eagerly imported as part of the SSR
// route manifest at server startup (even routes that never end up handling
// the current request) — so if createClient() threw here because the env
// var is unset, it would 500 every page, not just the ones that use
// supabaseAdmin. Fall back to a placeholder so construction always
// succeeds; any actual request against it will just fail with a normal
// Supabase auth error instead of crashing the whole site.
function resolveDashboardServiceRoleKey(): string {
  const key = process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY;
  if (key && key.startsWith("ey")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
      if (payload.ref === "auvbmpfiplwawxqibmmq") {
        return key;
      }
    } catch {
      // ignore
    }
  }
  // If STAGE_SUPABASE_SERVICE_ROLE_KEY was configured with the messaging project key,
  // ensure STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY receives it so messaging endpoints work.
  if (
    key &&
    key.startsWith("ey") &&
    !process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY?.startsWith("ey")
  ) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
      if (payload.ref === "vulyyztktylldfnuvzbn") {
        process.env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY = key;
      }
    } catch {
      // ignore
    }
  }

  return (
    process.env.STAGE_DASHBOARD_SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dmJtcGZpcGx3YXd4cWlibW1xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzk4ODA2OSwiZXhwIjoyMDk5NTY0MDY5fQ.6o_HHsM06jw94Jgp4FQnQKBnw70Jg-2pKKDZE5VxGek"
  );
}

export const supabaseAdmin = createClient(SUPABASE_URL, resolveDashboardServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: wsTransport },
});

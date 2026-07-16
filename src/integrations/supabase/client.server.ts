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
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY || "missing-STAGE_SUPABASE_SERVICE_ROLE_KEY",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: wsTransport },
  },
);

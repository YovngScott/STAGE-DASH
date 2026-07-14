import { createClient } from "@supabase/supabase-js";

// Server-only admin client for privileged operations against the
// external Stage AI Labs Supabase project.
const SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";

// supabase-js eagerly initializes a Realtime client (unused here), which
// requires a WebSocket implementation. Netlify's function runtime is on
// Node 20 (no native WebSocket until Node 22), so it must be provided
// explicitly or the client throws on construction during SSR.
const wsTransport =
  typeof WebSocket !== "undefined" ? WebSocket : (class {} as unknown as typeof WebSocket);

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: wsTransport },
  },
);

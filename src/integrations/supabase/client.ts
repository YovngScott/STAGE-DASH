import { createClient } from "@supabase/supabase-js";

// Stage AI Labs LLC — external Supabase project
// URL + anon key are publishable and safe to expose in the client bundle.
const SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dmJtcGZpcGx3YXd4cWlibW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODgwNjksImV4cCI6MjA5OTU2NDA2OX0.OmLrjoxBC26FrvyWq6e1fvnURnZZaBfAoAXyPeVFEPo";

// supabase-js eagerly initializes a Realtime client (unused here), which
// requires a WebSocket implementation. The local server may run on a Node
// runtime without native WebSocket, so it must be provided explicitly or
// the client throws on construction during SSR.
const wsTransport =
  typeof WebSocket !== "undefined" ? WebSocket : (class {} as unknown as typeof WebSocket);

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
  realtime: { transport: wsTransport },
});

export const SUPABASE_PROJECT_URL = SUPABASE_URL;

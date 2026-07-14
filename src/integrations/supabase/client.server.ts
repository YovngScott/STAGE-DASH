import { createClient } from "@supabase/supabase-js";

// Server-only admin client for privileged operations against the
// external Stage AI Labs Supabase project.
const SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  process.env.STAGE_SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

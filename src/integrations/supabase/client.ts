import { createClient } from "@supabase/supabase-js";

// Stage AI Labs LLC — external Supabase project
// URL + anon key are publishable and safe to expose in the client bundle.
const SUPABASE_URL = "https://auvbmpfiplwawxqibmmq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dmJtcGZpcGx3YXd4cWlibW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODgwNjksImV4cCI6MjA5OTU2NDA2OX0.OmLrjoxBC26FrvyWq6e1fvnURnZZaBfAoAXyPeVFEPo";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

export const SUPABASE_PROJECT_URL = SUPABASE_URL;

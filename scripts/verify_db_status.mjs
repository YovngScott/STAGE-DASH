import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const fname of ['.env', '.env.local']) {
  if (fs.existsSync(fname)) {
    const lines = fs.readFileSync(fname, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://auvbmpfiplwawxqibmmq.supabase.co";
const serviceKey = env.STAGE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("ERROR: No service role key found in .env or .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function verify() {
  console.log("=================================================");
  console.log("STAGE AI LABS - SUPABASE INFRASTRUCTURE AUDIT");
  console.log("Supabase URL:", supabaseUrl);
  console.log("=================================================\n");

  // 1. Audit 'tenants' table
  console.log("--- 1. Tenants (public.tenants) ---");
  const { data: tenants, error: tenantsErr } = await supabaseAdmin
    .from("tenants")
    .select("id, slug, name, phone, whatsapp_jid, created_at, status")
    .order("created_at", { ascending: false })
    .limit(10);

  if (tenantsErr) {
    console.log("Error querying tenants:", tenantsErr.message);
  } else {
    console.log(`Found ${tenants?.length || 0} tenants:`);
    console.table(tenants);
  }

  // 2. Audit 'client_bots' table
  console.log("\n--- 2. Client Bots (public.client_bots) ---");
  const { data: bots, error: botsErr } = await supabaseAdmin
    .from("client_bots")
    .select("id, client_id, name, status, phone_number, is_active, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (botsErr) {
    console.log("Error querying client_bots:", botsErr.message);
  } else {
    console.log(`Found ${bots?.length || 0} client bots:`);
    console.table(bots);
  }

  // 3. Audit 'clients' table
  console.log("\n--- 3. Clients (public.clients) ---");
  const { data: clients, error: clientsErr } = await supabaseAdmin
    .from("clients")
    .select("id, name, slug, phone, email, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (clientsErr) {
    console.log("Error querying clients:", clientsErr.message);
  } else {
    console.log(`Found ${clients?.length || 0} clients:`);
    console.table(clients);
  }

  // 4. Audit 'conversations' / 'messages' or messaging DB
  console.log("\n--- 4. Conversations / Chats (public.conversations / messages) ---");
  const { data: convos, error: convosErr } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (convosErr) {
    console.log("Notice on 'conversations' table:", convosErr.message);
  } else {
    console.log(`Found ${convos?.length || 0} conversations:`);
    console.table(convos);
  }

  // 5. Also check messaging supabase if configured
  if (env.STAGE_MESSAGING_SUPABASE_URL && env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\n--- 5. Messaging DB Instance (STAGE_MESSAGING_SUPABASE_URL) ---");
    const msgClient = createClient(
      env.STAGE_MESSAGING_SUPABASE_URL,
      env.STAGE_MESSAGING_SUPABASE_SERVICE_ROLE_KEY
    );
    const { data: msgConvos, error: msgErr } = await msgClient
      .from("conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (msgErr) {
      console.log("Messaging DB conversations query:", msgErr.message);
    } else {
      console.log(`Found ${msgConvos?.length || 0} messaging conversations:`);
      console.table(msgConvos);
    }
  }

  console.log("\n=================================================");
  console.log("AUDIT COMPLETED SUCCESSFULLY");
  console.log("=================================================");
}

verify().catch(console.error);

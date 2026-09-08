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

const supabaseAdmin = createClient(supabaseUrl, serviceKey);

async function inspect() {
  const { data: bots, error: botErr } = await supabaseAdmin.from('client_bots').select('*');
  console.log('--- client_bots ---', botErr || bots);

  const { data: clients, error: clErr } = await supabaseAdmin.from('clients').select('id, company_name, phone, email, status, bot_activo, created_at');
  console.log('--- clients ---', clErr || clients);

  const { data: leads, error: leadErr } = await supabaseAdmin.from('leads').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('--- leads ---', leadErr || leads);
}

inspect().catch(console.error);

-- ============================================================================
-- Stage AI Labs — Owner Console: alertas de salud de bots
-- Ejecutar UNA vez en el SQL Editor del Supabase del OWNER CONSOLE
-- (el mismo proyecto donde viven clients / client_bots / ledger_entries).
-- Idempotente: seguro de correr varias veces.
-- ============================================================================

create table if not exists owner_alerts (
  id           uuid primary key default gen_random_uuid(),
  bot_id       uuid,
  bot_slug     text,
  bot_name     text,
  client_name  text,
  type         text not null,               -- 'down' | 'wa_disconnected'
  severity     text not null default 'down',-- 'down' | 'warn'
  message      text not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz                  -- null = alerta activa
);

-- Índice para encontrar rápido las alertas abiertas de un bot.
create index if not exists idx_owner_alerts_abiertas
  on owner_alerts (bot_id) where resolved_at is null;
create index if not exists idx_owner_alerts_creada
  on owner_alerts (created_at desc);

-- Solo el backend del Owner Console (service role) lee/escribe estas alertas.
-- El navegador nunca toca la tabla directo: recibe las alertas a través del
-- endpoint /api/bot-health. RLS activo sin políticas = nadie con anon key.
alter table owner_alerts enable row level security;

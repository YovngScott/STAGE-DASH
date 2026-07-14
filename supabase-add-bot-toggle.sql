-- Run this in the Supabase SQL Editor for the shared Stage AI Labs project.
-- Adds the fields Client Manager needs to remotely turn a client's bot
-- on/off (e.g. Wiltech-Bot) from the dashboard. Safe to re-run.

alter table public.clients add column if not exists bot_status_url text;
alter table public.clients add column if not exists bot_secret text;
alter table public.clients add column if not exists bot_activo boolean not null default true;

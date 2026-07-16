-- Run this in the Supabase SQL Editor for the Stage AI Labs owner console.
-- Adds per-client resources so Client Manager can show multiple bots,
-- dashboards, web apps, and dashboard admin accounts for each client.
-- Safe to re-run.

create table if not exists public.client_bots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'messaging' check (kind in ('messaging', 'assistant', 'voice')),
  product_name text,
  status text not null default 'active' check (status in ('active', 'paused', 'draft', 'error')),
  bot_status_url text,
  bot_secret text,
  dashboard_url text,
  github_commit_url text,
  created_at timestamptz not null default now()
);

create index if not exists client_bots_client_id_idx on public.client_bots(client_id);
create unique index if not exists client_bots_slug_idx on public.client_bots(slug);

alter table public.client_bots enable row level security;
alter table public.client_bots add column if not exists bot_secret text;
alter table public.client_bots add column if not exists prompt_extra text not null default '';

drop policy if exists "Owner can view client bots" on public.client_bots;
drop policy if exists "Owner can insert client bots" on public.client_bots;
drop policy if exists "Owner can update client bots" on public.client_bots;
drop policy if exists "Owner can delete client bots" on public.client_bots;

create policy "Owner can view client bots"
  on public.client_bots for select to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create policy "Owner can insert client bots"
  on public.client_bots for insert to authenticated
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can update client bots"
  on public.client_bots for update to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can delete client bots"
  on public.client_bots for delete to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create table if not exists public.client_dashboards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bot_id uuid references public.client_bots(id) on delete set null,
  name text not null,
  slug text not null,
  url text,
  provider text not null default 'cloudflare',
  status text not null default 'draft' check (status in ('draft', 'live', 'paused', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists client_dashboards_client_id_idx on public.client_dashboards(client_id);

alter table public.client_dashboards enable row level security;

drop policy if exists "Owner can view client dashboards" on public.client_dashboards;
drop policy if exists "Owner can insert client dashboards" on public.client_dashboards;
drop policy if exists "Owner can update client dashboards" on public.client_dashboards;
drop policy if exists "Owner can delete client dashboards" on public.client_dashboards;

create policy "Owner can view client dashboards"
  on public.client_dashboards for select to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create policy "Owner can insert client dashboards"
  on public.client_dashboards for insert to authenticated
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can update client dashboards"
  on public.client_dashboards for update to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can delete client dashboards"
  on public.client_dashboards for delete to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create table if not exists public.client_email_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  display_name text,
  provider text not null default 'supabase-auth',
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  auth_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists client_email_accounts_client_id_idx on public.client_email_accounts(client_id);
create unique index if not exists client_email_accounts_email_idx on public.client_email_accounts(lower(email));

alter table public.client_email_accounts enable row level security;

drop policy if exists "Owner can view client email accounts" on public.client_email_accounts;
drop policy if exists "Owner can insert client email accounts" on public.client_email_accounts;
drop policy if exists "Owner can update client email accounts" on public.client_email_accounts;
drop policy if exists "Owner can delete client email accounts" on public.client_email_accounts;

create policy "Owner can view client email accounts"
  on public.client_email_accounts for select to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create policy "Owner can insert client email accounts"
  on public.client_email_accounts for insert to authenticated
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can update client email accounts"
  on public.client_email_accounts for update to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can delete client email accounts"
  on public.client_email_accounts for delete to authenticated
  using (public.has_role(auth.uid(), 'owner'));

alter table public.web_apps add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists web_apps_client_id_idx on public.web_apps(client_id);

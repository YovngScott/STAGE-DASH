-- Persistent registry and jobs for the no-code web application factory.
-- Safe to run repeatedly in the Owner Console Supabase project.

create table if not exists public.web_app_templates (
  id text primary key,
  name text not null,
  version text not null,
  description text not null default '',
  source_repo text not null,
  manifest jsonb not null,
  status text not null default 'active' check (status in ('active','disabled','draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_app_deployments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  web_app_id uuid references public.web_apps(id) on delete set null,
  template_id text not null references public.web_app_templates(id),
  template_version text not null,
  state text not null default 'draft' check (state in ('draft','preflight','queued','running','live','failed','rolling_back')),
  progress integer not null default 0 check (progress between 0 and 100),
  phase text not null default 'Borrador',
  config jsonb not null default '{}'::jsonb,
  repo_name text,
  fly_app_name text,
  supabase_project_ref text,
  public_url text,
  current_release text,
  previous_release text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists web_app_deployments_client_idx on public.web_app_deployments(client_id, created_at desc);
create unique index if not exists web_app_deployments_fly_app_idx on public.web_app_deployments(fly_app_name) where fly_app_name is not null;

alter table public.web_app_templates enable row level security;
alter table public.web_app_deployments enable row level security;

drop policy if exists "Owner manages web app templates" on public.web_app_templates;
create policy "Owner manages web app templates" on public.web_app_templates
  for all to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

drop policy if exists "Owner manages web app deployments" on public.web_app_deployments;
create policy "Owner manages web app deployments" on public.web_app_deployments
  for all to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

insert into public.web_app_templates (id, name, version, description, source_repo, manifest)
values (
  'workshop-management',
  'Gestión integral de taller',
  '1.0.0',
  'Casos, cotizaciones, piezas, almacén, citas, reportes y usuarios para talleres.',
  'YovngScott/stage-template-workshop',
  '{"schemaVersion":1,"id":"workshop-management","version":"1.0.0","compatibility":{"ownerConsole":">=1.0.0"},"fields":["companyName","legalName","phone","email","address","country","currency","timezone","brandPrimary","brandInk","receiptLegalText"],"modules":["cases","quotes","parts","inventory","appointments","reports","users","publicLanding"],"requiredSecrets":["SUPABASE_MANAGEMENT_TOKEN","SUPABASE_ORGANIZATION_ID","STAGE_FLY_API_TOKEN","STAGE_GITHUB_TOKEN"],"migrations":{"directory":"sql","strategy":"ordered"},"storageBuckets":["fotos-casos","documentos-casos","cotizaciones"],"requiredTests":["build","health","mobile","auth","rls","storage","rollback"]}'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  version = excluded.version,
  description = excluded.description,
  source_repo = excluded.source_repo,
  manifest = excluded.manifest,
  updated_at = now();

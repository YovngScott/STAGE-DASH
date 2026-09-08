-- OAuth multi-tenant, compatible con tokens existentes de Google Calendar/Sheets.
-- TABLA CONFIRMADA: public.google_oauth_tokens.
-- Evidencia: Wiltech-Bot/backend/src/services/calendar.ts y
-- Stage-Bot-Template/supabase/schema.sql la referencian explícitamente.
-- IMPORTANTE: ejecútalo en el proyecto Supabase del bot, no en el proyecto
-- central de STAGE-DASH (ese proyecto no contiene esta tabla).
-- Ejecutar en una ventana de mantenimiento: no revoca ni reemplaza refresh tokens.
begin;

do $$
begin
  if to_regclass('public.google_oauth_tokens') is null then
    raise exception 'Falta public.google_oauth_tokens. Conecta la consola al proyecto Supabase del bot/template; no al proyecto STAGE-DASH.';
  end if;
end $$;

alter table public.google_oauth_tokens
  add column if not exists provider text;

-- Algunas instalaciones pueden tener la columna creada pero nullable. Primero
-- normalizamos esos registros; después imponemos DEFAULT + NOT NULL.
update public.google_oauth_tokens
set provider = 'google'
where provider is null;

alter table public.google_oauth_tokens
  alter column provider set default 'google',
  alter column provider set not null;

-- La tabla histórica tenía tenant_id como PK (una fila por tenant) o una
-- restricción UNIQUE global. Elimina esas restricciones de unicidad simples,
-- conservando todas las filas y sus tokens activos.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.google_oauth_tokens'::regclass
      and contype in ('p','u')
      and array_length(conkey, 1) = 1
  loop
    execute format('alter table public.google_oauth_tokens drop constraint if exists %I', c.conname);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from public.google_oauth_tokens
    group by tenant_id, provider
    having count(*) > 1
  ) then
    raise exception 'No se puede crear UNIQUE(tenant_id, provider): existen duplicados; revísalos antes de reintentar.';
  end if;
end $$;

alter table public.google_oauth_tokens
  add constraint google_oauth_tokens_tenant_provider_key unique (tenant_id, provider);

create index if not exists idx_google_oauth_tokens_tenant_provider
  on public.google_oauth_tokens (tenant_id, provider);

commit;

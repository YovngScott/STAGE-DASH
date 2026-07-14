-- Run this in the Supabase SQL Editor for the shared Stage AI Labs project.
-- Creates the "ledger_entries" table backing the Financial Ledger and the
-- Dashboard's real MRR/investments/expenses figures. Safe to re-run.

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  label text not null,
  category text not null default 'General',
  amount numeric not null,
  kind text not null check (kind in ('investment', 'expense')),
  recurring boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.ledger_entries enable row level security;

-- Safe to re-run: drop policies before recreating them.
drop policy if exists "Owner can view ledger entries" on public.ledger_entries;
drop policy if exists "Owner can insert ledger entries" on public.ledger_entries;
drop policy if exists "Owner can update ledger entries" on public.ledger_entries;
drop policy if exists "Owner can delete ledger entries" on public.ledger_entries;

create policy "Owner can view ledger entries"
  on public.ledger_entries
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'owner'));

create policy "Owner can insert ledger entries"
  on public.ledger_entries
  for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can update ledger entries"
  on public.ledger_entries
  for update
  to authenticated
  using (public.has_role(auth.uid(), 'owner'))
  with check (public.has_role(auth.uid(), 'owner'));

create policy "Owner can delete ledger entries"
  on public.ledger_entries
  for delete
  to authenticated
  using (public.has_role(auth.uid(), 'owner'));

-- One-time seed of the entries that previously lived only in the browser's
-- local state (skipped automatically on re-run since the table won't be empty).
insert into public.ledger_entries (date, label, category, amount, kind, recurring)
select * from (values
  (date '2026-01-08', 'Company Formation · Wyoming LLC', 'Legal', 320, 'investment', false),
  (date '2026-01-10', 'Domain stage.ai purchase', 'Domain', 2400, 'investment', false),
  (date '2026-01-22', 'Development Infrastructure', 'Infrastructure', 1850, 'investment', false),
  (date '2026-02-15', 'Legal & registered agent (annual)', 'Legal', 410, 'investment', false),
  (date '2026-03-01', 'Initial capital injection', 'Capital', 7500, 'investment', false),
  (date '2026-07-01', 'OpenAI API', 'AI / LLM', 106, 'expense', true),
  (date '2026-07-01', 'Supabase Pro', 'Infrastructure', 25, 'expense', true),
  (date '2026-07-01', 'Twilio (WhatsApp + Voice)', 'Telephony', 62, 'expense', true),
  (date '2026-07-01', 'Vapi / Retell', 'Voice AI', 45, 'expense', true),
  (date '2026-07-01', 'Vercel + Netlify hosting', 'Hosting', 40, 'expense', true),
  (date '2026-07-01', 'GitHub Team', 'Software', 21, 'expense', true),
  (date '2026-07-01', 'Gym membership', 'Overhead', 21, 'expense', true)
) as seed(date, label, category, amount, kind, recurring)
where not exists (select 1 from public.ledger_entries);

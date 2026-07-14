-- Run this in the Supabase SQL Editor for the shared Stage AI Labs project.
-- Expands the products table's status constraint to allow the full set
-- the dashboard UI actually offers (active, in_development, testing, paused).

alter table public.products drop constraint if exists products_status_check;

alter table public.products
  add constraint products_status_check
  check (status = any (array['active', 'in_development', 'testing', 'paused']));

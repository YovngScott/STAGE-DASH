-- Run this in the Supabase SQL Editor for the shared Stage AI Labs project.
-- Adds "Custom Web Applications" to My Products so it shows up as a
-- selectable service in Client Manager (matches the landing page's product).
-- Safe to re-run: skipped if a product with this name already exists.

insert into public.products (name, category, description, status, monthly_cost)
select
  'Custom Web Applications',
  'automation',
  'Bespoke consoles, dashboards, and internal ERPs designed around how the client''s business actually runs.',
  'active',
  0
where not exists (
  select 1 from public.products where name = 'Custom Web Applications'
);

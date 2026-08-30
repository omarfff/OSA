-- Keep the singleton revenue-gate state server-only.
-- Direct access remains limited to postgres/service_role; the trigger function
-- is SECURITY DEFINER and has its own restricted EXECUTE ACL.
alter table public.osa_revenue_gate_state enable row level security;

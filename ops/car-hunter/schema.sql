-- OSA Car Hunter storage schema (Supabase/Postgres)
-- Service-role/server write path only. RLS is enabled with no public policies.

create extension if not exists pgcrypto;

create table if not exists public.car_hunter_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text,
  fingerprint text not null,
  url text,
  make text,
  model text,
  model_year int,
  mileage_km int,
  price_sar int,
  engine_code text,
  city text,
  seller_id text,
  seller_username text,
  title text,
  description text,
  images jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  non_cash_price_risk boolean not null default false,
  trim_claim_unverified boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  unique (source, external_id)
);

create table if not exists public.car_hunter_price_snapshots (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.car_hunter_listings(id) on delete cascade,
  price_sar int not null,
  observed_at timestamptz not null default now()
);

create table if not exists public.car_hunter_assessments (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.car_hunter_listings(id) on delete cascade,
  status text not null,
  deal_score int not null,
  mechanical_risk int not null,
  liquidity_score int not null,
  confidence_score int not null,
  quick_sale_value_sar int,
  maintenance_reserve_sar int,
  all_in_cost_sar int,
  net_upside_sar int,
  max_buy_sar int,
  assessment jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.car_hunter_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  candidate_count int not null default 0,
  listing_count int not null default 0,
  error_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists car_hunter_listings_market_idx
  on public.car_hunter_listings(make, model, model_year, mileage_km, price_sar);
create index if not exists car_hunter_listings_fingerprint_idx
  on public.car_hunter_listings(fingerprint);
create index if not exists car_hunter_price_history_idx
  on public.car_hunter_price_snapshots(listing_id, observed_at desc);
create index if not exists car_hunter_assessments_status_idx
  on public.car_hunter_assessments(status, deal_score desc, created_at desc);

alter table public.car_hunter_listings enable row level security;
alter table public.car_hunter_price_snapshots enable row level security;
alter table public.car_hunter_assessments enable row level security;
alter table public.car_hunter_runs enable row level security;

revoke all on public.car_hunter_listings from anon, authenticated;
revoke all on public.car_hunter_price_snapshots from anon, authenticated;
revoke all on public.car_hunter_assessments from anon, authenticated;
revoke all on public.car_hunter_runs from anon, authenticated;

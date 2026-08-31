create schema if not exists private;

create table if not exists private.osa_research_worker_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (label ~ '^[a-zA-Z0-9._-]{3,100}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

revoke all on private.osa_research_worker_tokens from public, anon, authenticated;

create table if not exists public.osa_research_jobs (
  id uuid primary key default gen_random_uuid(),
  query text not null check (char_length(btrim(query)) between 3 and 4000),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','cancelled')),
  priority smallint not null default 0 check (priority between 0 and 9),
  requested_by text not null default 'codex' check (requested_by ~ '^[a-zA-Z0-9:._-]{2,100}$'),
  dedupe_key text,
  not_before timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_until timestamptz,
  worker_id text,
  attempt smallint not null default 0 check (attempt between 0 and 10),
  max_attempts smallint not null default 2 check (max_attempts between 1 and 5),
  answer text check (answer is null or char_length(answer) <= 50000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  search_queries jsonb not null default '[]'::jsonb check (jsonb_typeof(search_queries) = 'array' and jsonb_array_length(search_queries) <= 10),
  provider text,
  model text,
  grounded boolean,
  source_backed boolean,
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  error text check (error is null or char_length(error) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint osa_research_job_time_order check (expires_at > created_at)
);

create index if not exists osa_research_jobs_claim_idx
  on public.osa_research_jobs (state, priority desc, not_before, created_at);
create unique index if not exists osa_research_jobs_dedupe_idx
  on public.osa_research_jobs (dedupe_key) where dedupe_key is not null;

alter table public.osa_research_jobs enable row level security;
revoke all on public.osa_research_jobs from public, anon, authenticated;
grant select, update on public.osa_research_jobs to anon;
grant select, insert, update, delete on public.osa_research_jobs to service_role;

create or replace function private.osa_research_worker_authorized()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.osa_research_worker_tokens t
    where t.active
      and t.token_hash = encode(sha256(convert_to(coalesce((coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-osa-worker-token'), ''), 'UTF8')), 'hex')
  );
$$;

revoke all on function private.osa_research_worker_authorized() from public;
grant usage on schema private to anon, service_role;
grant execute on function private.osa_research_worker_authorized() to anon, service_role;

drop policy if exists "research worker can read jobs" on public.osa_research_jobs;
create policy "research worker can read jobs"
  on public.osa_research_jobs for select to anon
  using ((select private.osa_research_worker_authorized()));

drop policy if exists "research worker can update jobs" on public.osa_research_jobs;
create policy "research worker can update jobs"
  on public.osa_research_jobs for update to anon
  using ((select private.osa_research_worker_authorized()))
  with check ((select private.osa_research_worker_authorized()));

create or replace function public.osa_submit_research_job(
  p_query text,
  p_requested_by text default 'codex',
  p_priority smallint default 0,
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid;
begin
  if char_length(btrim(coalesce(p_query, ''))) not between 3 and 4000 then raise exception 'invalid_research_query'; end if;
  if coalesce(p_requested_by, '') !~ '^[a-zA-Z0-9:._-]{2,100}$' then raise exception 'invalid_requested_by'; end if;
  if p_priority not between 0 and 9 then raise exception 'invalid_priority'; end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then raise exception 'invalid_metadata'; end if;
  insert into public.osa_research_jobs(query, requested_by, priority, dedupe_key, metadata)
  values (btrim(p_query), p_requested_by, p_priority, nullif(btrim(p_dedupe_key), ''), coalesce(p_metadata, '{}'::jsonb))
  on conflict (dedupe_key) where dedupe_key is not null do update set updated_at = public.osa_research_jobs.updated_at
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.osa_submit_research_job(text,text,smallint,text,jsonb) from public, anon, authenticated;
grant execute on function public.osa_submit_research_job(text,text,smallint,text,jsonb) to service_role;

create or replace function public.osa_claim_research_job(p_worker_id text)
returns setof public.osa_research_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(p_worker_id, '') !~ '^[a-zA-Z0-9:._-]{3,100}$' then raise exception 'invalid_worker_id'; end if;
  return query
  with reaped as (
    update public.osa_research_jobs
    set state = 'failed', completed_at = now(), updated_at = now(), error = case when expires_at <= now() then 'job_expired' else 'worker_lease_exhausted' end
    where (state = 'queued' and expires_at <= now())
       or (state = 'running' and lease_until <= now() and attempt >= max_attempts)
    returning id
  ), candidate as (
    select j.id from public.osa_research_jobs j
    where j.expires_at > now() and j.not_before <= now() and j.attempt < j.max_attempts
      and (j.state = 'queued' or (j.state = 'running' and j.lease_until <= now()))
    order by j.priority desc, j.created_at
    for update skip locked
    limit 1
  )
  update public.osa_research_jobs j
  set state = 'running', worker_id = p_worker_id, started_at = coalesce(j.started_at, now()),
      lease_until = now() + interval '5 minutes', attempt = j.attempt + 1, updated_at = now(), error = null
  from candidate c
  where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.osa_claim_research_job(text) from public, authenticated;
grant execute on function public.osa_claim_research_job(text) to anon, service_role;

create or replace function public.osa_finish_research_job(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object' then raise exception 'invalid_result'; end if;
  update public.osa_research_jobs j
  set state = case when p_success then 'succeeded' else 'failed' end,
      completed_at = now(), lease_until = null, updated_at = now(),
      answer = case when p_success then left(coalesce(p_result->>'answer', ''), 50000) else null end,
      sources = case when p_success and jsonb_typeof(p_result->'sources') = 'array' then p_result->'sources' else '[]'::jsonb end,
      search_queries = case when p_success and jsonb_typeof(p_result->'search_queries') = 'array' then p_result->'search_queries' else '[]'::jsonb end,
      provider = case when p_success then left(coalesce(p_result->>'provider', ''), 100) else null end,
      model = case when p_success then left(coalesce(p_result->>'model', ''), 100) else null end,
      grounded = case when p_success then coalesce((p_result->>'grounded')::boolean, false) else null end,
      source_backed = case when p_success then coalesce((p_result->>'source_backed')::boolean, false) else null end,
      usage = case when p_success and jsonb_typeof(p_result->'usage') = 'object' then p_result->'usage' else '{}'::jsonb end,
      error = case when p_success then null else left(coalesce(p_result->>'error', 'research_failed'), 2000) end
  where j.id = p_job_id and j.state = 'running' and j.worker_id = p_worker_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.osa_finish_research_job(uuid,text,boolean,jsonb) from public, authenticated;
grant execute on function public.osa_finish_research_job(uuid,text,boolean,jsonb) to anon, service_role;

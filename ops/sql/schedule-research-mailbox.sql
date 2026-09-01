create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.osa_enqueue_daily_opportunity_scan()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_day date := (now() at time zone 'Asia/Riyadh')::date;
  v_query text;
begin
  v_query := format(
    'Search as of %s for individual-accessible paid programming or AI bounties that are verifiably open now. Prioritize Algora, Superteam Earn, Gitcoin, and official comparable platforms. Exclude points, testnets, airdrops, contests without a currently open task, and anything requiring upfront payment. For each candidate require the exact task title, amount and currency, deadline, requirements, official direct task URL, and evidence that applications are still open. If no task meets every requirement, say: No sufficiently verified task found today.',
    v_day
  );

  insert into public.osa_research_jobs(query, requested_by, priority, dedupe_key, metadata)
  values (
    v_query,
    'supabase:daily-opportunity-scan',
    8,
    'paid-coding-opportunities-' || v_day::text,
    jsonb_build_object('purpose', 'daily_paid_opportunity_scan', 'local_day', v_day)
  )
  on conflict (dedupe_key) where dedupe_key is not null
  do update set updated_at = public.osa_research_jobs.updated_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.osa_enqueue_daily_opportunity_scan() from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'osa-daily-paid-opportunity-scan'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'osa-daily-paid-opportunity-scan',
    '0 6 * * *',
    'select private.osa_enqueue_daily_opportunity_scan()'
  );
end;
$$;

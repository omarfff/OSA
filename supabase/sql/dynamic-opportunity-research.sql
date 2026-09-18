-- Daily public-web research for concrete paid coding work.
-- Gemini Google Search is the discovery layer; official task and payout pages
-- remain the required evidence. This function only enqueues research and never
-- submits work, accepts terms, or moves money.
create or replace function private.osa_enqueue_daily_opportunity_scan()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_day date := (now() at time zone 'Asia/Riyadh')::date;
  v_seeds text;
  v_query text;
begin
  select string_agg(s.url, E'\n' order by s.id)
    into v_seeds
  from private.osa_research_watch_sources s
  where s.active;

  v_query := format(
    'Search the live public web as of %s for concrete paid programming, AI-agent, MCP, or developer-tool tasks that one independent contributor can start now. Search broadly; the seed URLs below are optional starting points, not a locked list:\n%s\n\nRequire every reported candidate to have: (1) an official reward or bounty page with exact amount and currency; (2) a canonical task or GitHub issue that is open, unassigned, and accepts outside contributions; (3) a clear claim/submission workflow; (4) no upfront payment; and (5) evidence about payout method plus geographic/KYC eligibility for a Saudi citizen currently residing in Egypt, or an explicit UNKNOWN when the official source does not say. Prefer tasks realistically completable in 2-48 hours, reward >= USD 50 equivalent, <=3 visible active attempts, recent maintainer activity, and escrow or an established payout platform. Reject unpaid/vague/claimed/expired tasks, points, raffles, referrals, airdrops, faucets, testnets, speculative contests, security exploitation, credential access, and anything that requires evading rules. Cross-check the canonical task and reward listing today. For each accepted candidate report exact title, repository/task, reward, direct official URLs, current state, attempt count, deadline, required skills, estimated effort, payout rail, eligibility evidence, and disqualifying uncertainty. Do not submit, claim, authenticate, contact anyone, accept terms, or move money. If none pass every hard requirement, say exactly: No sufficiently verified task found today.',
    v_day,
    coalesce(v_seeds, '(no seed URLs configured)')
  );

  insert into public.osa_research_jobs(query, requested_by, priority, dedupe_key, metadata)
  values (
    v_query,
    'supabase:daily-opportunity-scan',
    9,
    'paid-coding-opportunities-live-v3-' || v_day::text,
    jsonb_build_object(
      'purpose', 'daily_paid_opportunity_scan',
      'local_day', v_day,
      'discovery_mode', 'dynamic_public_web',
      'final_external_submission', 'human_gated'
    )
  )
  on conflict (dedupe_key) where dedupe_key is not null
  do update set updated_at = public.osa_research_jobs.updated_at
  returning id into v_id;

  return v_id;
end;
$function$;

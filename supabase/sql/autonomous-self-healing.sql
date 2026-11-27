-- OSA autonomous self-healing control plane.
-- Exported from live Supabase on 2026-11-27 after incident-reconciliation repair.
-- Deterministic playbooks are preferred; coding models are proposal-only.
-- Generative patches require isolated worktree, git apply check, deterministic tests,
-- origin/main lease verification and rollback/no-push on failure.

CREATE OR REPLACE FUNCTION osa_company.deterministic_reroute_failed_vps_task(p_vps_task_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v public.osa_vps_tasks%rowtype;
  p public.osa_control_policies%rowtype;
  exec_id uuid;
  out_id uuid;
begin
  select * into v from public.osa_vps_tasks where id=p_vps_task_id;
  if not found or v.state<>'failed' then return null; end if;
  if v.requested_by='osa_company.self_healer' then return null; end if;
  if v.failure_class not in ('PERMISSION_DENIED') then return null; end if;

  select * into p from public.osa_control_policies
  where operation=v.operation and enabled=true;
  if not found then return null; end if;

  if exists(
    select 1 from public.osa_vps_tasks x
    where x.requested_by='osa_company.self_healer'
      and x.metadata->>'repair_mode'='deterministic_reroute'
      and x.metadata->>'source_vps_task_id'=v.id::text
      and x.state in ('queued','running','succeeded')
  ) then
    select id into out_id from public.osa_vps_tasks x
    where x.requested_by='osa_company.self_healer'
      and x.metadata->>'repair_mode'='deterministic_reroute'
      and x.metadata->>'source_vps_task_id'=v.id::text
    order by requested_at desc limit 1;
    return out_id;
  end if;

  select a.id into exec_id
  from public.osa_vps_agents a
  where a.status='online'
    and a.last_seen>now()-interval '5 minutes'
    and a.id<>v.agent_id
    and coalesce(a.metadata->>'role','')=any(p.allowed_roles)
  order by
    (select count(*) from public.osa_vps_tasks q
      where q.agent_id=a.id and q.state in ('queued','running')) asc,
    a.last_seen desc
  limit 1;
  if exec_id is null then return null; end if;

  insert into public.osa_vps_tasks(
    agent_id,command,cwd,timeout_sec,state,operation,risk_level,
    rollback_command,verify_command,requested_at,requested_by,
    max_retries,attempt,idempotency_key,metadata
  ) values(
    exec_id,v.command,v.cwd,v.timeout_sec,'queued',v.operation,v.risk_level,
    v.rollback_command,v.verify_command,now(),'osa_company.self_healer',
    0,coalesce(v.attempt,0)+1,
    'self-heal-reroute-'||substr(md5(v.id::text||':'||now()::text),1,20),
    coalesce(v.metadata,'{}'::jsonb)||jsonb_build_object(
      'purpose','self-heal deterministic permission reroute',
      'repair_mode','deterministic_reroute',
      'self_heal_source_key','vps:'||v.id::text,
      'source_vps_task_id',v.id,
      'original_agent_id',v.agent_id,
      'rerouted_agent_id',exec_id,
      'why_now','Original worker returned PERMISSION_DENIED; retrying unchanged task on an online role explicitly allowed by the operation policy.',
      'kill_criteria','Only one deterministic reroute per source failure; if retry fails, escalate to generative self-heal or incident.',
      'revenue_impact',case when v.operation in ('git_write','migrate','payment_config','browser_commit') then 'blocker' else coalesce(v.metadata->>'revenue_impact','blocker') end,
      'external_evidence',jsonb_build_object('source_vps_task_id',v.id,'failure_class',v.failure_class,'original_agent_id',v.agent_id)
    )
  ) returning id into out_id;

  insert into osa_company.company_events(event_type,agent_key,division_id,outcome,payload)
  values(
    'self_heal_deterministic_reroute','eng.self-healer','engineering','success',
    jsonb_build_object(
      'source_vps_task_id',v.id,'retry_vps_task_id',out_id,
      'failure_class',v.failure_class,'from_agent',v.agent_id,'to_agent',exec_id,'at',now()
    )
  );
  return out_id;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.enqueue_self_heal_for_incident(p_incident_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  i osa_company.incidents%rowtype;
  t osa_company.tasks%rowtype;
  v public.osa_vps_tasks%rowtype;
  p jsonb;
begin
  select * into i from osa_company.incidents where incident_key=p_incident_key;
  if not found or i.status not in ('open','in_progress') then return null; end if;

  if i.source_type='vps_task' then
    begin
      return osa_company.enqueue_self_heal_for_vps_task(i.source_ref::uuid);
    exception when invalid_text_representation then null;
    end;
  end if;

  if i.source_type='company_task' then
    select * into t from osa_company.tasks where id::text=i.source_ref limit 1;
    if t.id is not null and nullif(t.evidence->>'dispatch_last_vps_task_id','') is not null then
      select * into v from public.osa_vps_tasks
      where id::text=t.evidence->>'dispatch_last_vps_task_id' limit 1;
    elsif t.id is not null and nullif(t.evidence->>'dispatch_vps_task_id','') is not null then
      select * into v from public.osa_vps_tasks
      where id::text=t.evidence->>'dispatch_vps_task_id' limit 1;
    end if;
  end if;

  p := jsonb_build_object(
    'failure_class',v.failure_class,'last_error',coalesce(v.last_error,''),
    'stderr',coalesce(v.stderr,''),'stdout',coalesce(v.stdout,''),
    'purpose',coalesce(v.metadata->>'purpose','incident repair'),
    'vps_task_id',v.id,'occurred_at',i.opened_at,
    'company_task_id',t.id,'task_key',t.task_key,'title',t.title,
    'blocked_reason',t.blocked_reason,'incident_key',i.incident_key,'summary',i.summary
  );
  return osa_company.enqueue_self_heal_payload('incident:'||i.incident_key,p);
end
$function$


CREATE OR REPLACE FUNCTION osa_company.enqueue_self_heal_for_vps_task(p_vps_task_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v public.osa_vps_tasks%rowtype;
  t osa_company.tasks%rowtype;
  i osa_company.incidents%rowtype;
  p jsonb;
  deterministic_id uuid;
begin
  select * into v from public.osa_vps_tasks where id=p_vps_task_id;
  if not found or v.state<>'failed' then return null; end if;
  if v.requested_by='osa_company.self_healer'
     or coalesce(v.metadata->>'purpose','') ilike '%self-heal%'
     or coalesce(v.metadata->>'purpose','') ilike '%self healing%'
  then return null; end if;

  deterministic_id:=osa_company.deterministic_reroute_failed_vps_task(v.id);
  if deterministic_id is not null then return deterministic_id; end if;

  if nullif(v.metadata->>'company_task_id','') is not null then
    select * into t from osa_company.tasks
    where id::text=v.metadata->>'company_task_id' limit 1;
  end if;

  select * into i
  from osa_company.incidents
  where (source_type='vps_task' and source_ref=v.id::text)
     or (t.id is not null and source_type='company_task' and source_ref=t.id::text)
  order by case severity when 'critical' then 1 when 'high' then 2 else 3 end,opened_at desc
  limit 1;

  p := jsonb_build_object(
    'failure_class',v.failure_class,'last_error',coalesce(v.last_error,''),
    'stderr',coalesce(v.stderr,''),'stdout',coalesce(v.stdout,''),
    'purpose',v.metadata->>'purpose','vps_task_id',v.id,
    'occurred_at',coalesce(v.completed_at,v.requested_at),
    'company_task_id',t.id,'task_key',t.task_key,'title',t.title,
    'blocked_reason',t.blocked_reason,'incident_key',i.incident_key,'summary',i.summary
  );
  return osa_company.enqueue_self_heal_payload('vps:'||v.id::text,p);
end
$function$


CREATE OR REPLACE FUNCTION osa_company.enqueue_self_heal_payload(p_source_key text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  active_id uuid;
  exec_id uuid;
  payload jsonb;
  payload_b64 text;
  cmd text;
  out_id uuid;
begin
  select id into active_id
  from public.osa_vps_tasks
  where requested_by='osa_company.self_healer'
    and state in ('queued','running')
  order by requested_at asc
  limit 1;
  if active_id is not null then return active_id; end if;

  select id into active_id
  from public.osa_vps_tasks
  where requested_by='osa_company.self_healer'
    and metadata->>'self_heal_source_key'=p_source_key
    and state='succeeded'
    and completed_at>now()-interval '30 minutes'
  order by completed_at desc
  limit 1;
  if active_id is not null then return active_id; end if;

  select a.id into exec_id
  from public.osa_vps_agents a
  where a.status='online'
    and a.last_seen>now()-interval '5 minutes'
    and coalesce(a.metadata->>'role','') in ('build','controller')
  order by
    case when a.metadata->>'role'='build' then 1 else 2 end,
    (select count(*) from public.osa_vps_tasks q
      where q.agent_id=a.id and q.state in ('queued','running')) asc,
    a.last_seen desc
  limit 1;
  if exec_id is null then return null; end if;

  payload := jsonb_strip_nulls(jsonb_build_object(
    'source_key',left(coalesce(p_source_key,''),500),
    'failure_class',left(coalesce(p_payload->>'failure_class',''),300),
    'last_error',left(coalesce(p_payload->>'last_error',''),4500),
    'stderr',left(coalesce(p_payload->>'stderr',''),4500),
    'stdout',left(coalesce(p_payload->>'stdout',''),2500),
    'summary',left(coalesce(p_payload->>'summary',''),2200),
    'blocked_reason',left(coalesce(p_payload->>'blocked_reason',''),1800),
    'task_key',left(coalesce(p_payload->>'task_key',''),400),
    'title',left(coalesce(p_payload->>'title',''),700),
    'purpose',left(coalesce(p_payload->>'purpose',''),1000),
    'incident_key',left(coalesce(p_payload->>'incident_key',''),500),
    'vps_task_id',left(coalesce(p_payload->>'vps_task_id',''),100),
    'company_task_id',left(coalesce(p_payload->>'company_task_id',''),100),
    'occurred_at',coalesce(p_payload->'occurred_at',to_jsonb(now())),
    'run_full_tests',true
  ));

  payload_b64 := replace(encode(convert_to(payload::text,'UTF8'),'base64'),E'\n','');
  if octet_length(payload_b64)>24000 then return null; end if;

  cmd := format($CMD$
set -Eeuo pipefail
cd /opt/osa/gitops/OSA
git fetch origin main --quiet
if [ -z "$(git status --porcelain)" ]; then
  git checkout main >/dev/null 2>&1 || true
  git merge --ff-only origin/main
fi
export OSA_AGENT_ALLOW_WRITE=1
export OSA_SELF_HEAL_MODEL='qwen2.5-coder:1.5b'
node tools/osa-self-healing-engineer.mjs %L
$CMD$,payload_b64);

  insert into public.osa_vps_tasks(
    agent_id,command,cwd,timeout_sec,state,operation,risk_level,
    requested_at,requested_by,max_retries,attempt,idempotency_key,metadata
  ) values(
    exec_id,cmd,'/opt/osa/gitops/OSA',600,'queued','git_write','medium',
    now(),'osa_company.self_healer',0,0,
    'self-heal-'||substr(md5(p_source_key||':'||now()::text),1,24),
    jsonb_build_object(
      'purpose','autonomous self-healing engineer',
      'self_heal_source_key',p_source_key,
      'source_vps_task_id',nullif(p_payload->>'vps_task_id',''),
      'source_incident_key',nullif(p_payload->>'incident_key',''),
      'source_company_task_id',nullif(p_payload->>'company_task_id',''),
      'model','qwen2.5-coder:1.5b',
      'verification_contract','isolated worktree + git apply check + deterministic tests + origin lease + rollback on failure',
      'owner_authorized',true,
      'external_write',true,
      'revenue_impact','blocker',
      'external_evidence',jsonb_build_object(
        'source_key',p_source_key,
        'failure_class',payload->>'failure_class',
        'incident_key',payload->>'incident_key',
        'source_vps_task_id',payload->>'vps_task_id'
      ),
      'why_now','A verified runtime/code failure or high/critical incident is blocking company execution; owner explicitly authorized autonomous repair.',
      'kill_criteria','Abort and do not push if worktree is dirty, sensitive paths would change, git apply fails, deterministic tests fail, origin/main changes during repair, or no verified patch exists.'
    )
  )
  returning id into out_id;

  insert into osa_company.company_events(event_type,agent_key,division_id,outcome,payload)
  values(
    'self_heal_enqueued','eng.self-healer','engineering','success',
    jsonb_build_object(
      'source_key',p_source_key,'vps_task_id',out_id,
      'executor_vps_agent_id',exec_id,'model','qwen2.5-coder:1.5b','at',now()
    )
  );
  return out_id;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_operational_incidents(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  progressed jsonb;
  superseded integer;
begin
  progressed:=osa_company.reconcile_progressed_company_incidents(p_date);
  superseded:=osa_company.reconcile_superseded_vps_incidents();
  return jsonb_build_object(
    'company_incidents',progressed,
    'superseded_vps_incidents_resolved',superseded
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_progressed_company_incidents(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  resolved_n integer:=0;
  deferred_n integer:=0;
  reopened_n integer:=0;
  rc integer:=0;
begin
  -- Successful dispatch means the incident that represented "no progress" is resolved.
  update osa_company.incidents i
  set status='resolved',
      resolved_at=coalesce(i.resolved_at,now()),
      last_progress_at=greatest(coalesce(i.last_progress_at,'epoch'::timestamptz),
                                nullif(t.evidence->>'dispatch_last_completed_at','')::timestamptz),
      details=i.details||jsonb_build_object(
        'resolution','Latest dispatch succeeded after incident opened; progress incident closed.',
        'resolved_by','osa_company.reconcile_progressed_company_incidents',
        'dispatch_last_vps_task_id',t.evidence->>'dispatch_last_vps_task_id',
        'dispatch_last_completed_at',t.evidence->>'dispatch_last_completed_at',
        'resolved_at',now()
      ),
      updated_at=now()
  from osa_company.tasks t
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status in ('open','in_progress')
    and t.plan_date=p_date
    and t.state not in ('blocked','waiting','failed')
    and t.evidence->>'dispatch_last_state'='succeeded'
    and nullif(t.evidence->>'dispatch_last_completed_at','') is not null
    and (t.evidence->>'dispatch_last_completed_at')::timestamptz >= i.opened_at
    and osa_company.task_execution_contract(
      t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
    ) <> 'external_wait';
  get diagnostics rc=row_count; resolved_n:=resolved_n+rc;

  -- External waits are not code/runtime failures and must not stay Critical/High.
  update osa_company.incidents i
  set status='deferred',
      details=i.details||jsonb_build_object(
        'deferred_reason','External decision/wait is non-actionable by self-healer.',
        'deferred_by','osa_company.reconcile_progressed_company_incidents',
        'deferred_at',now()
      ),
      updated_at=now()
  from osa_company.tasks t
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status in ('open','in_progress')
    and t.plan_date=p_date
    and osa_company.task_execution_contract(
      t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
    )='external_wait';
  get diagnostics rc=row_count; deferred_n:=deferred_n+rc;

  -- A later real dispatch failure or blocked state reopens a previously resolved progress incident.
  update osa_company.incidents i
  set status=case when t.state='in_progress' then 'in_progress' else 'open' end,
      resolved_at=null,
      details=i.details||jsonb_build_object(
        'reopened_reason','Source task has a newer failed dispatch or is blocked.',
        'reopened_by','osa_company.reconcile_progressed_company_incidents',
        'dispatch_last_vps_task_id',t.evidence->>'dispatch_last_vps_task_id',
        'reopened_at',now()
      ),
      updated_at=now()
  from osa_company.tasks t
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status='resolved'
    and t.plan_date=p_date
    and (
      t.state='blocked'
      or (
        t.evidence->>'dispatch_last_state'='failed'
        and nullif(t.evidence->>'dispatch_last_completed_at','') is not null
        and (t.evidence->>'dispatch_last_completed_at')::timestamptz > coalesce(i.resolved_at,'epoch'::timestamptz)
      )
    );
  get diagnostics rc=row_count; reopened_n:=reopened_n+rc;

  return jsonb_build_object(
    'resolved_after_progress',resolved_n,
    'external_wait_deferred',deferred_n,
    'reopened_on_new_failure',reopened_n
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_self_heal_runs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r record;
  n_ok integer:=0;
  n_fail integer:=0;
  is_ok boolean;
  result_excerpt text;
begin
  for r in
    select *
    from public.osa_vps_tasks
    where requested_by='osa_company.self_healer'
      and state in ('succeeded','failed','cancelled')
      and coalesce(metadata->>'self_heal_reconciled','false')<>'true'
    order by completed_at nulls last,requested_at
    limit 30
  loop
    result_excerpt := left(coalesce(r.stdout,'')||E'\n'||coalesce(r.stderr,''),7000);
    is_ok := r.state='succeeded'
      and (
        r.metadata->>'repair_mode'='deterministic_reroute'
        or (
          result_excerpt like '%SELF_HEAL_RESULT=%'
          and (result_excerpt like '%"ok":true%' or result_excerpt like '%\"ok\":true%')
        )
      );

    if is_ok then
      update osa_company.incidents
      set status='resolved',resolved_at=coalesce(resolved_at,now()),
          details=details||jsonb_build_object(
            'resolution',case when r.metadata->>'repair_mode'='deterministic_reroute'
              then 'Autonomous deterministic reroute succeeded on an allowed worker.'
              else 'Autonomous Self-Healing Engineer returned verified success.' end,
            'self_heal_vps_task_id',r.id,
            'self_heal_result_excerpt',left(result_excerpt,3500),
            'resolved_by','osa_company.reconcile_self_heal_runs','resolved_at',now()
          ),updated_at=now()
      where status in ('open','in_progress','deferred')
        and (
          incident_key=r.metadata->>'source_incident_key'
          or (source_type='vps_task' and source_ref=r.metadata->>'source_vps_task_id')
          or (source_type='company_task' and source_ref=r.metadata->>'source_company_task_id')
        );
      n_ok:=n_ok+1;
    else
      update osa_company.incidents
      set details=details||jsonb_build_object(
            'self_heal_last_attempt_vps_task_id',r.id,
            'self_heal_last_attempt_state',r.state,
            'self_heal_last_result_excerpt',left(result_excerpt,3500),
            'self_heal_last_attempt_at',coalesce(r.completed_at,now())
          ),updated_at=now()
      where status in ('open','in_progress')
        and (
          incident_key=r.metadata->>'source_incident_key'
          or (source_type='vps_task' and source_ref=r.metadata->>'source_vps_task_id')
          or (source_type='company_task' and source_ref=r.metadata->>'source_company_task_id')
        );
      n_fail:=n_fail+1;
    end if;

    insert into osa_company.company_events(event_type,agent_key,division_id,outcome,payload)
    values(
      'self_heal_completed','eng.self-healer','engineering',
      case when is_ok then 'success' else 'failure' end,
      jsonb_build_object(
        'self_heal_vps_task_id',r.id,'source_key',r.metadata->>'self_heal_source_key',
        'repair_mode',r.metadata->>'repair_mode',
        'source_vps_task_id',r.metadata->>'source_vps_task_id',
        'source_incident_key',r.metadata->>'source_incident_key',
        'model',r.metadata->>'model','state',r.state,'verified_success',is_ok,
        'result_excerpt',left(result_excerpt,5000),'at',now()
      )
    );

    insert into osa_brain.events(event_type,domain,subject,payload,outcome,reward,evidence_ref)
    values(
      'verified_outcome','engineering','self_heal_cycle',
      jsonb_build_object(
        'source_key',r.metadata->>'self_heal_source_key',
        'self_heal_vps_task_id',r.id,'repair_mode',r.metadata->>'repair_mode',
        'model',r.metadata->>'model','verified_success',is_ok,
        'result_excerpt',left(result_excerpt,5000)
      ),
      case when is_ok then 'self_heal_verified' else 'self_heal_not_verified' end,
      case when is_ok then 1 else -1 end,'vps_task:'||r.id::text
    );

    insert into osa_brain.lessons(
      lesson_key,summary,evidence_count,success_count,failure_count,score,confidence,
      metadata,first_event_at,last_event_at
    )
    values(
      'engineering.autonomous_self_heal_loop',
      'Use deterministic playbooks first (reroute/reaper/reconcile), then tool-grounded coding repair only when needed. Any code patch must pass isolated worktree, git apply check, deterministic tests, origin lease and rollback/no-push on failure.',
      1,case when is_ok then 1 else 0 end,case when is_ok then 0 else 1 end,
      case when is_ok then 1 else -1 end,0.92,
      jsonb_build_object('latest_vps_task_id',r.id,'latest_verified_success',is_ok,'repair_mode',r.metadata->>'repair_mode','model',r.metadata->>'model'),
      now(),now()
    )
    on conflict(lesson_key) do update set
      summary=excluded.summary,
      evidence_count=osa_brain.lessons.evidence_count+1,
      success_count=osa_brain.lessons.success_count+case when is_ok then 1 else 0 end,
      failure_count=osa_brain.lessons.failure_count+case when is_ok then 0 else 1 end,
      score=case when is_ok then least(1,osa_brain.lessons.score+0.1) else greatest(-1,osa_brain.lessons.score-0.15) end,
      confidence=least(0.99,osa_brain.lessons.confidence+0.01),
      metadata=osa_brain.lessons.metadata||excluded.metadata,
      last_event_at=now(),updated_at=now();

    update public.osa_vps_tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'self_heal_reconciled',true,'self_heal_verified_success',is_ok,'self_heal_reconciled_at',now()
    )
    where id=r.id;
  end loop;
  return jsonb_build_object('verified_successes',n_ok,'not_verified',n_fail);
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_superseded_vps_incidents()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  n integer:=0;
begin
  update osa_company.incidents i
  set status='resolved',
      resolved_at=coalesce(i.resolved_at,now()),
      details=i.details||jsonb_build_object(
        'resolution','Earlier VPS failure superseded by later successful execution for the same company task/tool purpose.',
        'resolved_by','osa_company.reconcile_superseded_vps_incidents',
        'resolved_at',now()
      ),
      updated_at=now()
  where i.source_type='vps_task'
    and i.status in ('open','in_progress','deferred')
    and exists (
      select 1
      from public.osa_vps_tasks failed
      where failed.id::text=i.source_ref
        and failed.state='failed'
        and (
          exists (
            select 1
            from public.osa_vps_tasks ok
            where ok.state='succeeded'
              and ok.requested_at>failed.requested_at
              and (
                (
                  nullif(failed.metadata->>'company_task_id','') is not null
                  and ok.metadata->>'company_task_id'=failed.metadata->>'company_task_id'
                )
                or (
                  nullif(failed.metadata->>'purpose','') is not null
                  and ok.metadata->>'purpose'=failed.metadata->>'purpose'
                  and ok.requested_by=failed.requested_by
                )
              )
          )
          or (
            coalesce(failed.metadata->>'purpose','') ilike '%Workparty%'
            and exists (
              select 1 from public.osa_vps_tasks ok
              where ok.state='succeeded'
                and ok.requested_at>failed.requested_at
                and coalesce(ok.metadata->>'purpose','') ilike '%Workparty%'
            )
          )
          or (
            coalesce(failed.metadata->>'purpose','')='ceo_learning_cycle'
            and exists (
              select 1 from public.osa_vps_tasks ok
              where ok.state='succeeded'
                and ok.requested_at>failed.requested_at
                and ok.metadata->>'purpose'='ceo_learning_cycle'
            )
          )
          or (
            coalesce(failed.metadata->>'purpose','') ilike '%TaskMarket readiness%'
            and exists (
              select 1 from public.osa_vps_tasks ok
              where ok.state='succeeded'
                and ok.requested_at>failed.requested_at
                and coalesce(ok.metadata->>'purpose','') ilike '%TaskMarket%'
            )
          )
        )
    );

  get diagnostics n=row_count;
  return n;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.self_heal_cycle()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  active_id uuid;
  candidate_id uuid;
  incident_key text;
  enqueued uuid;
  reconciled jsonb;
begin
  perform public.osa_reap_stuck_vps_tasks();
  reconciled := osa_company.reconcile_self_heal_runs();
  perform osa_company.reconcile_operational_incidents(((now() at time zone 'Africa/Cairo')::date));

  select id into active_id
  from public.osa_vps_tasks
  where requested_by='osa_company.self_healer' and state in ('queued','running')
  order by requested_at asc limit 1;
  if active_id is not null then
    return jsonb_build_object('state','active','self_heal_vps_task_id',active_id,'reconciled',reconciled);
  end if;

  select v.id into candidate_id
  from public.osa_vps_tasks v
  where v.state='failed'
    and v.requested_at>now()-interval '30 minutes'
    and v.requested_by<>'osa_company.self_healer'
    and coalesce(v.metadata->>'purpose','') not ilike '%self-heal%'
    and not exists(
      select 1 from public.osa_vps_tasks h
      where h.requested_by='osa_company.self_healer'
        and h.metadata->>'source_vps_task_id'=v.id::text
    )
    and not exists(
      select 1 from public.osa_vps_tasks ok
      where ok.state='succeeded'
        and ok.requested_at>v.requested_at
        and coalesce(ok.metadata->>'purpose','')=coalesce(v.metadata->>'purpose','')
    )
  order by v.requested_at desc
  limit 1;

  if candidate_id is not null then
    enqueued:=osa_company.enqueue_self_heal_for_vps_task(candidate_id);
    return jsonb_build_object(
      'state','enqueued_recent_failed_vps_task',
      'source_vps_task_id',candidate_id,'self_heal_vps_task_id',enqueued,'reconciled',reconciled
    );
  end if;

  select i.incident_key into incident_key
  from osa_company.incidents i
  where i.status in ('open','in_progress') and i.severity in ('critical','high')
    and not exists(
      select 1 from public.osa_vps_tasks h
      where h.requested_by='osa_company.self_healer'
        and h.metadata->>'source_incident_key'=i.incident_key
        and h.state in ('queued','running','succeeded')
        and h.requested_at>now()-interval '24 hours'
    )
  order by case i.severity when 'critical' then 1 else 2 end,i.opened_at desc
  limit 1;

  if incident_key is not null then
    enqueued:=osa_company.enqueue_self_heal_for_incident(incident_key);
    return jsonb_build_object('state','enqueued_incident','source_incident_key',incident_key,'self_heal_vps_task_id',enqueued,'reconciled',reconciled);
  end if;

  return jsonb_build_object('state','healthy','reconciled',reconciled);
end
$function$


CREATE OR REPLACE FUNCTION osa_company.trigger_self_heal_on_incident()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status in ('open','in_progress') and new.severity in ('critical','high')
     and (tg_op='INSERT' or old.status is distinct from new.status or old.severity is distinct from new.severity)
  then perform osa_company.enqueue_self_heal_for_incident(new.incident_key); end if;
  return new;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.trigger_self_heal_on_vps_failure()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.state='failed' and old.state is distinct from new.state
     and new.requested_by<>'osa_company.self_healer'
     and coalesce(new.metadata->>'purpose','') not ilike '%self-heal%'
  then perform osa_company.enqueue_self_heal_for_vps_task(new.id); end if;
  return new;
end
$function$



drop trigger if exists trg_osa_vps_task_self_heal on public.osa_vps_tasks;
create trigger trg_osa_vps_task_self_heal
after update of state on public.osa_vps_tasks
for each row
when (new.state='failed' and old.state is distinct from new.state)
execute function osa_company.trigger_self_heal_on_vps_failure();

drop trigger if exists trg_incident_self_heal on osa_company.incidents;
create trigger trg_incident_self_heal
after insert or update of status,severity on osa_company.incidents
for each row
execute function osa_company.trigger_self_heal_on_incident();

do $$
begin
  if exists(select 1 from cron.job where jobname='osa-company-self-heal-5m') then
    perform cron.unschedule('osa-company-self-heal-5m');
  end if;
  perform cron.schedule(
    'osa-company-self-heal-5m',
    '*/5 * * * *',
    'select osa_company.self_heal_cycle();'
  );
end
$$;

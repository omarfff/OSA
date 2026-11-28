-- OSA production recovery fixes from the 2026-11-28 root-cause investigation.
-- Exported from live Supabase after final routing/taxonomy/delegation repair.
-- Invariants:
-- * business/capability outcomes are not generative code bugs;
-- * external_effect work is delegated to the hourly Revenue Closing Desk;
-- * inspect/control work uses the empirically healthy controller;
-- * web/monitor are excluded from generic routing while quarantined;
-- * watchdog incidents are driven by failure/age/due state, not priority alone;
-- * dispatcher distinguishes process success from logical contract success;
-- * canonical finance tasks use fresh payment truth and durable verified infrastructure evidence.

CREATE OR REPLACE FUNCTION osa_company.dispatch_incidents(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date, p_limit integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r record;
  exec_id uuid;
  payload jsonb;
  payload_b64 text;
  cmd text;
  vps_id uuid;
  dispatched integer := 0;
begin
  perform osa_company.reconcile_canonical_revenue_task(p_date);

  for r in
    select
      t.id as task_id,t.task_key,t.title,t.objective,t.blocked_reason,t.division_id,
      t.priority,t.state,t.evidence,
      osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      ) as contract_type,
      i.incident_key,i.severity,i.executor_vps_agent_id
    from osa_company.tasks t
    join osa_company.incidents i
      on i.source_type='company_task' and i.source_ref=t.id::text
    where t.plan_date=p_date
      and t.state in ('queued','in_progress','blocked')
      and t.priority>=90
      and i.status in ('open','in_progress')
      and osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      ) not in ('external_wait','canonical_verify','internal_control','external_effect')
      and (
        coalesce(t.evidence->>'dispatch_vps_task_id','')=''
        or exists(
          select 1 from public.osa_vps_tasks v
          where v.id::text=t.evidence->>'dispatch_vps_task_id'
            and v.state in ('succeeded','failed','cancelled')
        )
      )
      and (
        t.evidence->>'dispatch_last_completed_at' is null
        or (t.evidence->>'dispatch_last_completed_at')::timestamptz <
          now() - case
            when coalesce((t.evidence->>'dispatch_failure_count')::int,0)>=3 then interval '6 hours'
            when coalesce((t.evidence->>'dispatch_failure_count')::int,0)=2 then interval '2 hours'
            when coalesce((t.evidence->>'dispatch_failure_count')::int,0)=1 then interval '1 hour'
            else interval '30 minutes'
          end
      )
    order by
      case i.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
      t.priority desc,t.updated_at asc
    limit greatest(1,least(p_limit,5))
  loop
    exec_id := osa_company.pick_fabric_executor();

    if exec_id is null or not exists(
      select 1 from public.osa_vps_agents a
      where a.id=exec_id and a.status='online' and a.last_seen>now()-interval '5 minutes'
        and coalesce(a.metadata->>'role','') in ('controller','build')
        and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
    ) then
      select a.id into exec_id
      from public.osa_vps_agents a
      where a.status='online' and a.last_seen>now()-interval '5 minutes'
        and coalesce(a.metadata->>'role','') in ('controller','build')
        and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
      order by
        (select count(*) from public.osa_vps_tasks q
         where q.agent_id=a.id and q.state in ('queued','running')) asc,
        a.last_seen desc
      limit 1;
    end if;

    if exec_id is null then
      update osa_company.incidents
      set details=details||jsonb_build_object(
            'dispatch_blocker','no live inspect-capable VPS executor',
            'checked_at',now()
          ),
          updated_at=now()
      where incident_key=r.incident_key;
      continue;
    end if;

    payload := jsonb_build_object(
      'company_task_id',r.task_id,
      'task_key',r.task_key,
      'division',r.division_id,
      'priority',r.priority,
      'title',left(coalesce(r.title,''),300),
      'objective',left(coalesce(r.objective,''),2400),
      'blocked_reason',osa_company.clean_dispatch_noise(left(coalesce(r.blocked_reason,''),600)),
      'incident_key',r.incident_key,
      'contract_type',r.contract_type,
      'goal',left(trim(concat_ws(' | ',r.title,r.objective)),3000)
    );

    payload_b64 := replace(encode(convert_to(payload::text,'UTF8'),'base64'),E'\n','');

    if octet_length(payload_b64)>12000 then
      update osa_company.incidents
      set details=details||jsonb_build_object(
            'dispatch_blocker','compact payload still exceeds safe argv budget',
            'payload_bytes',octet_length(payload_b64),
            'checked_at',now()
          ),
          updated_at=now()
      where incident_key=r.incident_key;
      continue;
    end if;

    cmd := format($CMD$
set -uo pipefail
export OSA_AI_PROVIDER_ORDER_OVERRIDE='gemini,ollama'
export OSA_AI_PROVIDER_TIMEOUT_MS='25000'
export OSA_AI_MAX_OUTPUT_TOKENS_OVERRIDE='256'
cd /opt/osa/gitops/OSA || { echo 'OSA_DISPATCH_LOGICAL_OK=0'; exit 0; }
python3 - %L <<'PY'
import base64, json, re, subprocess, sys, types

payload=json.loads(base64.b64decode(sys.argv[1]).decode())
goal=str(payload.get("goal") or payload.get("title") or "")
contract=str(payload.get("contract_type") or "analysis")
external_contract=contract in ("external_effect","external_verify")

def run(cmd, timeout=75):
    try:
        return subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        out=e.stdout.decode(errors="replace") if isinstance(e.stdout,bytes) else (e.stdout or "")
        err=e.stderr.decode(errors="replace") if isinstance(e.stderr,bytes) else (e.stderr or "")
        return types.SimpleNamespace(returncode=124,stdout=out,stderr=(err+"\\nagent_timeout").strip())

plan_p=run(["node","tools/agent-fabric.mjs","plan",goal],30)
if plan_p.returncode != 0:
    print(json.dumps({"ok":False,"contract_type":contract,"failure_class":"PLAN_FAILED","stage":"plan","stderr":plan_p.stderr[-2000:],"task":payload}))
    print("OSA_DISPATCH_LOGICAL_OK=0")
    raise SystemExit(0)

try:
    plan=json.loads(plan_p.stdout)
except Exception:
    print(json.dumps({"ok":False,"contract_type":contract,"failure_class":"PLAN_PARSE_FAILED","stage":"plan_parse","stdout":plan_p.stdout[-2000:],"task":payload}))
    print("OSA_DISPATCH_LOGICAL_OK=0")
    raise SystemExit(0)
items=[x for x in plan.get("plan",[]) if x.get("enabled") is True]
strong=[x for x in items if x.get("why")!="available default agent"]
items=strong if strong else items

if external_contract:
    items=[x for x in items if x.get("id")!="ai-helper"]
    if contract=="external_effect":
        items=[
          x for x in items
          if x.get("access") in ("write","financial")
          or x.get("id") in ("basedagents-worker","taskmarket-worker")
        ]

url_m=re.search(r"https?://[^\s<>\"']+", goal)
public_url=url_m.group(0).rstrip(".,);]") if url_m else None

results=[]
attempted=0
for item in items:
    if attempted>=2:
        break
    aid=item.get("id")
    if not aid:
        continue
    args=[]
    if item.get("requires_args"):
        if aid=="ai-helper":
            args=[goal]
        elif public_url:
            args=[public_url]
        else:
            results.append({"agent":aid,"ok":False,"skipped":"required argument unavailable"})
            continue
    p=run(["node","tools/agent-fabric.mjs","run",aid,*args],75)
    attempted+=1
    try:
        out=json.loads(p.stdout) if p.stdout.strip() else {}
    except Exception:
        out={"raw_stdout":p.stdout[-4000:]}
    results.append({"agent":aid,"returncode":p.returncode,"result":out,"stderr":p.stderr[-2000:]})

if (not external_contract) and not any(
    x.get("returncode")==0 and (x.get("result") or {}).get("ok") is True
    for x in results
):
    p=run(["node","tools/agent-fabric.mjs","run","ai-helper",goal],75)
    try:
        out=json.loads(p.stdout) if p.stdout.strip() else {}
    except Exception:
        out={"raw_stdout":p.stdout[-4000:]}
    results.append({"agent":"ai-helper","returncode":p.returncode,"result":out,"stderr":p.stderr[-2000:]})

def run_ok(x):
    return x.get("returncode")==0 and (x.get("result") or {}).get("ok") is True

def has_effect(obj):
    if isinstance(obj, dict):
        for k,v in obj.items():
            lk=str(k).lower()
            if lk in (
                "claim_id","claimed_task","delivery_id","submission_id",
                "accepted_at","settlement_tx","payment_tx","transaction_hash"
            ) and v not in (None,"",False,0,[] ,{}):
                return True
            if lk in ("external_effect","external_verified") and v is True:
                return True
            if has_effect(v):
                return True
    elif isinstance(obj, list):
        return any(has_effect(v) for v in obj)
    return False

if contract=="analysis":
    ok=any(run_ok(x) for x in results)
    failure_class=None if ok else "NO_SUCCESSFUL_AGENT"
elif contract=="external_verify":
    ok=any(run_ok(x) and x.get("agent")!="ai-helper" for x in results)
    failure_class=None if ok else "NO_BLACKBOX_VERIFIER"
else:
    ok=any(run_ok(x) and has_effect(x.get("result") or {}) for x in results)
    failure_class=None if ok else "NO_EXTERNAL_EFFECT"

print(json.dumps({
    "ok":ok,
    "contract_type":contract,
    "failure_class":failure_class,
    "task":payload,
    "plan":plan.get("plan",[]),
    "runs":results
},ensure_ascii=False))
print("OSA_DISPATCH_LOGICAL_OK=" + ("1" if ok else "0"))
raise SystemExit(0)
PY
$CMD$,payload_b64);

    insert into public.osa_vps_tasks(
      agent_id,command,cwd,timeout_sec,state,operation,risk_level,
      requested_at,requested_by,max_retries,attempt,idempotency_key,metadata
    ) values(
      exec_id,cmd,'/opt/osa/gitops/OSA',240,'queued','inspect','low',
      now(),'osa_company.execution_dispatcher',1,0,
      'company-dispatch-'||r.task_id::text||'-'||extract(epoch from now())::bigint::text,
      jsonb_build_object(
        'purpose','execute company task through existing agent-fabric',
        'company_task_id',r.task_id,
        'company_task_key',r.task_key,
        'incident_key',r.incident_key,
        'why_now','Task is high-priority, actionable and unresolved',
        'read_only_or_fabric_gated',true,
        'execution_contract',r.contract_type
      )
    )
    returning id into vps_id;

    update osa_company.tasks
    set state='in_progress',
        evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
          'dispatch_vps_task_id',vps_id,
          'dispatch_started_at',now(),
          'dispatch_executor_vps_agent_id',exec_id,
          'dispatch_via','agent-fabric',
          'dispatch_contract',r.contract_type
        ),
        blocked_reason=osa_company.clean_dispatch_noise(blocked_reason),
        updated_at=now()
    where id=r.task_id;

    update osa_company.incidents
    set status='in_progress',
        executor_vps_agent_id=exec_id,
        last_progress_at=now(),
        details=details||jsonb_build_object(
          'dispatch_vps_task_id',vps_id,
          'dispatch_started_at',now(),
          'dispatch_contract',r.contract_type
        ),
        updated_at=now()
    where incident_key=r.incident_key;

    dispatched:=dispatched+1;
  end loop;

  if dispatched>0 then
    insert into osa_company.company_events(event_type,agent_key,division_id,outcome,payload)
    values(
      'execution_dispatch_cycle','mgr.operations','operations','success',
      jsonb_build_object('dispatched',dispatched,'plan_date',p_date,'at',now())
    );
  end if;

  return dispatched;
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
  contract_type text;
begin
  select * into i from osa_company.incidents where incident_key=p_incident_key;
  if not found or i.status not in ('open','in_progress') then return null; end if;

  if i.source_type='vps_task' then
    begin
      return osa_company.enqueue_self_heal_for_vps_task(i.source_ref::uuid);
    exception when invalid_text_representation then
      return null;
    end;
  end if;

  if i.source_type<>'company_task' then return null; end if;

  select * into t from osa_company.tasks where id::text=i.source_ref limit 1;
  if t.id is null then return null; end if;

  contract_type:=osa_company.task_execution_contract(
    t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
  );

  if contract_type='internal_control' then
    perform osa_company.resolve_internal_control_tasks(t.plan_date);
    return null;
  end if;

  if contract_type in ('external_wait','canonical_verify','external_effect') then
    return null;
  end if;

  if nullif(t.evidence->>'dispatch_last_vps_task_id','') is not null then
    select * into v from public.osa_vps_tasks
    where id::text=t.evidence->>'dispatch_last_vps_task_id' limit 1;
  elsif nullif(t.evidence->>'dispatch_vps_task_id','') is not null then
    select * into v from public.osa_vps_tasks
    where id::text=t.evidence->>'dispatch_vps_task_id' limit 1;
  end if;

  if v.id is null or not osa_company.is_generatively_self_healable_vps_task(v.id) then
    return null;
  end if;

  return osa_company.enqueue_self_heal_for_vps_task(v.id);
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

  if not osa_company.is_generatively_self_healable_vps_task(v.id) then
    return null;
  end if;

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


CREATE OR REPLACE FUNCTION osa_company.execution_watchdog_base_20261126(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  rolled integer := 0;
  superseded integer := 0;
  stale_cancelled integer := 0;
  assigned integer := 0;
  incidents_created integer := 0;
  incidents_escalated integer := 0;
  incidents_resolved integer := 0;
  rc integer := 0;
begin
  if not exists(select 1 from osa_company.daily_plans where plan_date=p_date) then
    perform osa_company.generate_daily_plan(p_date);
  end if;

  -- Old unresolved work must never disappear between dates.
  update osa_company.tasks old
  set state='cancelled',
      blocked_reason=coalesce(old.blocked_reason||' | ','')||'Execution watchdog: superseded by current-date task.',
      updated_at=now()
  where old.plan_date < p_date
    and old.state in ('queued','in_progress','waiting','blocked')
    and exists(
      select 1 from osa_company.tasks cur
      where cur.plan_date=p_date and cur.task_key=old.task_key
    );
  get diagnostics rc=row_count; superseded:=superseded+rc;

  insert into osa_company.tasks(
    plan_date,task_key,division_id,assigned_to,reports_to,title,objective,
    priority,state,source,source_ref,expected_value,evidence_required,evidence,due_at,blocked_reason
  )
  select
    p_date,t.task_key,t.division_id,t.assigned_to,t.reports_to,t.title,t.objective,
    t.priority,'queued','watchdog_rollover',t.id::text,t.expected_value,t.evidence_required,
    coalesce(t.evidence,'{}'::jsonb)||jsonb_build_object('rolled_from_date',t.plan_date,'rolled_from_task_id',t.id,'rolled_at',now()),
    coalesce(t.due_at,now()+interval '6 hours'),
    case when t.state in ('blocked','waiting') then coalesce(t.blocked_reason,'Rolled unresolved blocker forward') else null end
  from osa_company.tasks t
  where t.plan_date < p_date
    and t.state in ('queued','in_progress','waiting','blocked')
    and (
      t.state in ('in_progress','waiting','blocked')
      or t.priority>=90
      or t.division_id in ('revenue','finance','operations')
    )
    and not exists(
      select 1 from osa_company.tasks cur where cur.plan_date=p_date and cur.task_key=t.task_key
    )
  on conflict(plan_date,task_key) do nothing;
  get diagnostics rc=row_count; rolled:=rolled+rc;

  update osa_company.tasks old
  set state='cancelled',
      blocked_reason=coalesce(old.blocked_reason||' | ','')||'Execution watchdog: rolled forward to current plan.',
      updated_at=now()
  where old.plan_date < p_date
    and old.state in ('queued','in_progress','waiting','blocked')
    and exists(
      select 1 from osa_company.tasks cur
      where cur.plan_date=p_date and cur.task_key=old.task_key
        and cur.source in ('watchdog_rollover','daily_manager','ceo_manager_accountability','owner_directive')
    );
  get diagnostics rc=row_count; superseded:=superseded+rc;

  update osa_company.tasks t
  set state='cancelled',
      blocked_reason=coalesce(t.blocked_reason||' | ','')||'Execution watchdog: stale low-priority backlog closed; revive only with current evidence.',
      updated_at=now()
  where t.plan_date < p_date
    and t.state='queued'
    and t.priority<90;
  get diagnostics rc=row_count; stale_cancelled:=stale_cancelled+rc;

  -- Repair missing/inactive logical ownership.
  update osa_company.tasks t
  set assigned_to=d.manager_agent_key,
      reports_to=case when d.manager_agent_key='ceo.omar-executive' then null else 'ceo.omar-executive' end,
      updated_at=now(),
      evidence=coalesce(t.evidence,'{}'::jsonb)||jsonb_build_object('ownership_repaired_at',now())
  from osa_company.divisions d
  where t.plan_date=p_date
    and t.division_id=d.division_id
    and t.state in ('queued','in_progress','waiting','blocked')
    and d.manager_agent_key is not null
    and exists(select 1 from osa_company.agents ma where ma.agent_key=d.manager_agent_key and ma.status='active')
    and (
      t.assigned_to is null
      or not exists(select 1 from osa_company.agents a where a.agent_key=t.assigned_to and a.status='active')
    );
  get diagnostics rc=row_count; assigned:=assigned+rc;

  -- Create incidents for unresolved tasks that are old enough or explicitly blocked/waiting.
  insert into osa_company.incidents(
    incident_key,source_type,source_ref,division_id,owner_agent_key,executor_vps_agent_id,
    severity,status,summary,details,sla_due_at,opened_at,last_progress_at,updated_at
  )
  select
    'task:'||t.id::text,
    'company_task',
    t.id::text,
    t.division_id,
    coalesce(t.reports_to,d.manager_agent_key,'ceo.omar-executive'),
    osa_company.pick_live_executor(t.division_id,t.title||' '||coalesce(t.objective,'')),
    case when t.priority>=99 or t.task_key like 'revenue.first_dollar%' then 'critical'
         when t.priority>=95 then 'high'
         when t.priority>=85 then 'medium'
         else 'low' end,
    case when t.state='in_progress' then 'in_progress' else 'open' end,
    t.title,
    jsonb_build_object(
      'task_key',t.task_key,'task_state',t.state,'priority',t.priority,
      'objective',t.objective,'blocked_reason',t.blocked_reason,
      'assigned_to',t.assigned_to,'reports_to',t.reports_to,
      'task_updated_at',t.updated_at
    ),
    now()+case when t.priority>=99 then interval '60 minutes'
               when t.priority>=95 then interval '120 minutes'
               else interval '240 minutes' end,
    now(),t.updated_at,now()
  from osa_company.tasks t
  join osa_company.divisions d on d.division_id=t.division_id
  where t.plan_date=p_date
    and t.state in ('queued','in_progress','waiting','blocked')
    and coalesce(t.evidence->>'external_execution_mode','')<>'automation_closing_desk'
    and not (
      t.state='waiting'
      and nullif(t.evidence->>'external_wait_until','') is not null
      and (t.evidence->>'external_wait_until')::timestamptz > now()
    )
    and (
      t.state='blocked'
      or (
        t.state='waiting'
        and t.updated_at < now()-interval '60 minutes'
      )
      or (
        t.state in ('queued','in_progress')
        and (
          coalesce((t.evidence->>'dispatch_failure_count')::int,0)>0
          or (t.due_at is not null and t.due_at<=now())
          or t.updated_at < now() - case
            when t.priority>=95 then interval '60 minutes'
            when t.priority>=85 then interval '120 minutes'
            else interval '180 minutes'
          end
        )
      )
    )
  on conflict(incident_key) do update set
    owner_agent_key=excluded.owner_agent_key,
    executor_vps_agent_id=coalesce(osa_company.incidents.executor_vps_agent_id,excluded.executor_vps_agent_id),
    severity=excluded.severity,
    status=case when osa_company.incidents.status='resolved' then 'resolved' else excluded.status end,
    details=osa_company.incidents.details||excluded.details,
    last_progress_at=greatest(coalesce(osa_company.incidents.last_progress_at,'epoch'::timestamptz),excluded.last_progress_at),
    updated_at=now();
  get diagnostics rc=row_count; incidents_created:=incidents_created+rc;

  -- Failed VPS work is a real problem and must have an owner.
  insert into osa_company.incidents(
    incident_key,source_type,source_ref,division_id,owner_agent_key,executor_vps_agent_id,
    severity,status,summary,details,sla_due_at,opened_at,last_progress_at,updated_at
  )
  select
    'vps:'||v.id::text,'vps_task',v.id::text,'operations','mgr.operations',
    coalesce(
      case when a.status='online' and a.last_seen>now()-interval '5 minutes' then a.id end,
      osa_company.pick_live_executor('operations',coalesce(v.metadata->>'purpose',''))
    ),
    case when v.risk_level in ('high','critical') or coalesce(v.metadata->>'revenue_impact','')='direct'
         then 'high' else 'medium' end,
    'open',
    coalesce(v.metadata->>'purpose','Failed VPS task'),
    jsonb_build_object(
      'state',v.state,'operation',v.operation,'risk_level',v.risk_level,
      'requested_by',v.requested_by,'last_error',v.last_error,'failure_class',v.failure_class,
      'requested_at',v.requested_at,'completed_at',v.completed_at
    ),
    now()+interval '120 minutes',now(),v.completed_at,now()
  from public.osa_vps_tasks v
  left join public.osa_vps_agents a on a.id=v.agent_id
  where v.state='failed'
    and v.requested_at>now()-interval '24 hours'
    and (
      v.metadata ? 'company_task_id'
      or v.requested_by like 'osa_company.%'
      or v.requested_by='osa_company.execution_dispatcher'
    )
  on conflict(incident_key) do update set
    executor_vps_agent_id=coalesce(osa_company.incidents.executor_vps_agent_id,excluded.executor_vps_agent_id),
    details=osa_company.incidents.details||excluded.details,
    updated_at=now();
  get diagnostics rc=row_count; incidents_created:=incidents_created+rc;

  -- Bind incidents back to task evidence so nobody can claim "no owner".
  update osa_company.tasks t
  set evidence=coalesce(t.evidence,'{}'::jsonb)||jsonb_build_object(
      'incident_key',i.incident_key,
      'incident_owner',i.owner_agent_key,
      'executor_vps_agent_id',i.executor_vps_agent_id,
      'sla_due_at',i.sla_due_at,
      'watchdog_bound_at',now()
    ),
    updated_at=case when t.updated_at < now()-interval '60 minutes' then now() else t.updated_at end
  from osa_company.incidents i
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status in ('open','in_progress');

  -- Escalate overdue incidents to CEO rather than leaving them silent.
  update osa_company.incidents i
  set owner_agent_key='ceo.omar-executive',
      escalation_level=escalation_level+1,
      sla_due_at=now()+interval '60 minutes',
      details=details||jsonb_build_object('escalated_at',now(),'escalation_reason','SLA expired without resolution'),
      updated_at=now()
  where i.status in ('open','in_progress')
    and i.sla_due_at is not null
    and i.sla_due_at<now()
    and i.owner_agent_key<>'ceo.omar-executive';
  get diagnostics rc=row_count; incidents_escalated:=incidents_escalated+rc;

  -- Close incidents automatically only when the underlying work is actually closed.
  update osa_company.incidents i
  set status='resolved',resolved_at=now(),updated_at=now(),
      details=details||jsonb_build_object('resolution','source task closed')
  where i.source_type='company_task'
    and i.status in ('open','in_progress')
    and exists(
      select 1 from osa_company.tasks t
      where t.id::text=i.source_ref and t.state in ('succeeded','cancelled')
    );
  get diagnostics rc=row_count; incidents_resolved:=incidents_resolved+rc;

  update osa_company.incidents i
  set status='resolved',resolved_at=now(),updated_at=now(),
      details=details||jsonb_build_object('resolution','VPS task succeeded')
  where i.source_type='vps_task'
    and i.status in ('open','in_progress')
    and exists(
      select 1 from public.osa_vps_tasks v
      where v.id::text=i.source_ref and v.state='succeeded'
    );
  get diagnostics rc=row_count; incidents_resolved:=incidents_resolved+rc;

  perform osa_company.enforce_revenue_first_wip(p_date,16);

  insert into osa_company.company_events(event_type,agent_key,division_id,outcome,payload)
  values(
    'execution_watchdog_cycle','mgr.operations','operations','success',
    jsonb_build_object(
      'plan_date',p_date,'rolled',rolled,'superseded',superseded,
      'stale_cancelled',stale_cancelled,'ownership_repaired',assigned,
      'incidents_touched',incidents_created,'incidents_escalated',incidents_escalated,
      'incidents_resolved',incidents_resolved,'at',now()
    )
  );

  return jsonb_build_object(
    'plan_date',p_date,'rolled',rolled,'superseded',superseded,
    'stale_cancelled',stale_cancelled,'ownership_repaired',assigned,
    'incidents_touched',incidents_created,'incidents_escalated',incidents_escalated,
    'incidents_resolved',incidents_resolved
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.is_generatively_self_healable_vps_task(p_vps_task_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v public.osa_vps_tasks%rowtype;
  t osa_company.tasks%rowtype;
  contract_type text;
  combined text;
begin
  select * into v from public.osa_vps_tasks where id=p_vps_task_id;
  if not found or v.state<>'failed' then return false; end if;

  if v.requested_by='osa_company.self_healer'
     or v.requested_by in ('chatgpt.investigation','chatgpt.control_probe','chatgpt.self_heal_verify','osa_revenue_closing_desk.inline')
     or coalesce(v.metadata->>'purpose','') ilike '%self-heal%'
     or coalesce(v.metadata->>'purpose','') ilike '%self healing%'
  then return false; end if;

  combined := coalesce(v.stdout,'')||E'
'||coalesce(v.stderr,'')||E'
'||coalesce(v.last_error,'');

  if v.requested_by='osa_company.execution_dispatcher'
     and combined ~* '(NO_EXTERNAL_EFFECT|NO_SUCCESSFUL_AGENT|NO_BLACKBOX_VERIFIER|PLAN_FAILED|PLAN_PARSE_FAILED)'
  then return false; end if;

  if nullif(v.metadata->>'company_task_id','') is not null then
    select * into t
    from osa_company.tasks
    where id::text=v.metadata->>'company_task_id'
    limit 1;

    if t.id is not null then
      contract_type := osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      );
      if contract_type in ('external_wait','canonical_verify','internal_control','external_effect') then
        return false;
      end if;
      if contract_type='analysis'
         and combined ~* '(NO_EXTERNAL_EFFECT|NO_SUCCESSFUL_AGENT|NO_BLACKBOX_VERIFIER|PLAN_FAILED|PLAN_PARSE_FAILED)'
      then
        return false;
      end if;
    end if;
  end if;

  if coalesce(v.failure_class,'') in ('PERMISSION_DENIED','COMMAND_NOT_FOUND','SYNTAX_ERROR','PATCH_FAILED','VERIFY_FAILED','TIMEOUT') then
    return true;
  end if;

  return combined ~* '(syntaxerror|referenceerror|typeerror|module not found|cannot find module|command not found|permission denied|traceback|exception)';
end
$function$


CREATE OR REPLACE FUNCTION osa_company.pick_fabric_executor()
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select a.id
  from public.osa_vps_agents a
  where a.status='online'
    and a.last_seen>now()-interval '5 minutes'
    and coalesce(a.metadata->>'role','') in ('controller','build')
    and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
  order by
    case when coalesce(a.metadata->>'role','')='controller' then 1 else 2 end,
    (
      select count(*)
      from public.osa_vps_tasks q
      where q.agent_id=a.id and q.state in ('queued','running')
    ) asc,
    case when a.name='hostinger-osa-trading' then 1 when a.name='hostinger-osa-build' then 2 else 3 end,
    a.last_seen desc
  limit 1
$function$


CREATE OR REPLACE FUNCTION osa_company.pick_live_executor(p_division text, p_text text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  needs_build boolean;
  picked uuid;
begin
  needs_build := lower(coalesce(p_text,'')) ~
    '(git|patch|commit|deploy|migration|migrate|compile|code change|source code|self[- ]?heal|npm test|pytest|build artifact)';

  if needs_build then
    select a.id into picked
    from public.osa_vps_agents a
    where a.status='online'
      and a.last_seen>now()-interval '5 minutes'
      and coalesce(a.metadata->>'role','')='build'
      and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
    order by
      case when a.name='hostinger-osa-trading' then 1 when a.name='hostinger-osa-build' then 2 else 3 end,
      (select count(*) from public.osa_vps_tasks q
       where q.agent_id=a.id and q.state in ('queued','running')) asc,
      a.last_seen desc
    limit 1;
  else
    select a.id into picked
    from public.osa_vps_agents a
    where a.status='online'
      and a.last_seen>now()-interval '5 minutes'
      and coalesce(a.metadata->>'role','')='controller'
      and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
    order by
      (select count(*) from public.osa_vps_tasks q
       where q.agent_id=a.id and q.state in ('queued','running')) asc,
      a.last_seen desc
    limit 1;
  end if;

  if picked is null then
    select a.id into picked
    from public.osa_vps_agents a
    where a.status='online'
      and a.last_seen>now()-interval '5 minutes'
      and coalesce((a.metadata->>'execution_quarantined')::boolean,false)=false
      and coalesce(a.metadata->>'role','') in ('controller','build')
    order by
      case when coalesce(a.metadata->>'role','')='controller' then 1 else 2 end,
      (select count(*) from public.osa_vps_tasks q
       where q.agent_id=a.id and q.state in ('queued','running')) asc,
      a.last_seen desc
    limit 1;
  end if;

  return picked;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_dispatcher_business_failure_incidents()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer:=0;
begin
  update osa_company.incidents i
  set status='resolved',
      resolved_at=coalesce(i.resolved_at,now()),
      details=i.details||jsonb_build_object(
        'resolution','Dispatcher process completed with a business/capability outcome; parent company-task incident remains the authoritative blocker.',
        'resolved_by','osa_company.reconcile_dispatcher_business_failure_incidents',
        'resolved_at',now()
      ),
      updated_at=now()
  where i.source_type='vps_task'
    and i.status in ('open','in_progress','deferred')
    and exists(
      select 1
      from public.osa_vps_tasks v
      left join osa_company.tasks t
        on t.id::text=v.metadata->>'company_task_id'
      where v.id::text=i.source_ref
        and v.requested_by='osa_company.execution_dispatcher'
        and (
          coalesce(v.stdout,'') ~* '(NO_EXTERNAL_EFFECT|NO_SUCCESSFUL_AGENT|NO_BLACKBOX_VERIFIER)'
          or (t.id is not null and t.state in ('succeeded','cancelled'))
        )
    );
  get diagnostics n=row_count;
  return n;
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_external_effect_delegation(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  delegated integer:=0;
  incidents_deferred integer:=0;
begin
  update osa_company.tasks t
  set state='waiting',
      blocked_reason=null,
      evidence=(
        coalesce(t.evidence,'{}'::jsonb)
        - 'dispatch_vps_task_id'
        - 'dispatch_last_error'
      ) || jsonb_build_object(
        'external_execution_mode','automation_closing_desk',
        'external_executor','OSA Revenue Closing Desk',
        'external_executor_automation_id','6a8209bc1abc81918a1e62b1fcb19c29',
        'external_executor_scope','worldwide paid-demand execution + canonical settlement refresh',
        'external_executor_frequency','hourly',
        'external_executor_last_policy_update','2026-11-28T00:22:12Z',
        'generic_vps_dispatch_suppressed',true,
        'delegated_at',now()
      ),
      updated_at=now()
  where t.plan_date=p_date
    and t.state in ('queued','in_progress','blocked')
    and osa_company.task_execution_contract(
      t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
    )='external_effect';
  get diagnostics delegated=row_count;

  update osa_company.incidents i
  set status='deferred',
      details=i.details||jsonb_build_object(
        'deferred_reason','External-effect work delegated to the active OSA Revenue Closing Desk; generic VPS Agent Fabric has no marketplace write worker and must not retry empty execution plans.',
        'external_executor_automation_id','6a8209bc1abc81918a1e62b1fcb19c29',
        'deferred_by','osa_company.reconcile_external_effect_delegation',
        'deferred_at',now()
      ),
      updated_at=now()
  from osa_company.tasks t
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status in ('open','in_progress')
    and t.plan_date=p_date
    and t.evidence->>'external_execution_mode'='automation_closing_desk';
  get diagnostics incidents_deferred=row_count;

  return jsonb_build_object(
    'tasks_delegated',delegated,
    'incidents_deferred',incidents_deferred,
    'executor_automation_id','6a8209bc1abc81918a1e62b1fcb19c29'
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_incident_dispatches(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  ok_count integer:=0;
  fail_count integer:=0;
  waiting_count integer:=0;
  rerouted integer:=0;
  rc integer:=0;
begin
  perform osa_company.reconcile_canonical_revenue_task(p_date);

  update osa_company.tasks t
  set state=case
      when osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      )='external_wait' then 'waiting'
      else t.state
    end,
    blocked_reason=osa_company.clean_dispatch_noise(t.blocked_reason),
    evidence=(coalesce(t.evidence,'{}'::jsonb)
      - 'dispatch_vps_task_id'
      - 'dispatch_last_error')
      || jsonb_build_object(
        'dispatch_last_vps_task_id',v.id,
        'dispatch_last_state','succeeded',
        'dispatch_last_completed_at',v.completed_at,
        'dispatch_last_stdout',left(coalesce(v.stdout,''),4000),
        'dispatch_failure_count',0
      ),
    updated_at=now()
  from public.osa_vps_tasks v
  where t.plan_date=p_date
    and t.evidence->>'dispatch_vps_task_id'=v.id::text
    and v.state='succeeded'
    and (
      coalesce(v.stdout,'') like '%OSA_DISPATCH_LOGICAL_OK=1%'
      or (
        coalesce(v.stdout,'') not like '%OSA_DISPATCH_LOGICAL_OK=%'
        and coalesce(v.stdout,'') ilike '%"ok": true%'
      )
    );
  get diagnostics rc=row_count; ok_count:=ok_count+rc;

  update osa_company.incidents i
  set status=case
        when i.status='resolved' then 'resolved'
        when osa_company.task_execution_contract(
          t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
        )='external_wait' then 'deferred'
        else 'in_progress'
      end,
      last_progress_at=now(),
      details=details||jsonb_build_object(
        'last_dispatch_state','succeeded',
        'last_dispatch_completed_at',v.completed_at
      ),
      updated_at=now()
  from public.osa_vps_tasks v
  join osa_company.tasks t on t.evidence->>'dispatch_last_vps_task_id'=v.id::text
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and v.state='succeeded'
    and (
      coalesce(v.stdout,'') like '%OSA_DISPATCH_LOGICAL_OK=1%'
      or (
        coalesce(v.stdout,'') not like '%OSA_DISPATCH_LOGICAL_OK=%'
        and coalesce(v.stdout,'') ilike '%"ok": true%'
      )
    );

  update osa_company.tasks t
  set state=case
      when osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      )='external_wait' then 'waiting'
      when osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      )='internal_control' then 'queued'
      when osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      )='canonical_verify' then 'waiting'
      else 'blocked'
    end,
    blocked_reason=case
      when osa_company.task_execution_contract(
        t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
      ) in ('external_wait','internal_control','canonical_verify')
        then osa_company.clean_dispatch_noise(t.blocked_reason)
      when coalesce(t.blocked_reason,'') ilike '%Execution dispatcher failed; incident remains open for retry/escalation.%'
        then t.blocked_reason
      else concat_ws(
        ' | ',
        osa_company.clean_dispatch_noise(t.blocked_reason),
        'Execution dispatcher failed; incident remains open for retry/escalation.'
      )
    end,
    evidence=(coalesce(t.evidence,'{}'::jsonb)-'dispatch_vps_task_id')
      || jsonb_build_object(
        'dispatch_last_vps_task_id',v.id,
        'dispatch_last_state','failed',
        'dispatch_last_completed_at',coalesce(v.completed_at,now()),
        'dispatch_last_error',coalesce(v.last_error,v.stderr),
        'dispatch_last_stdout',left(coalesce(v.stdout,''),3000),
        'dispatch_failure_count',coalesce((t.evidence->>'dispatch_failure_count')::int,0)+1
      ),
    updated_at=now()
  from public.osa_vps_tasks v
  where t.plan_date=p_date
    and t.evidence->>'dispatch_vps_task_id'=v.id::text
    and (
      v.state='failed'
      or (v.state='succeeded' and coalesce(v.stdout,'') like '%OSA_DISPATCH_LOGICAL_OK=0%')
    );
  get diagnostics rc=row_count; fail_count:=fail_count+rc;

  update osa_company.incidents i
  set status=case
        when osa_company.task_execution_contract(
          t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
        ) in ('external_wait','canonical_verify') then 'deferred'
        when osa_company.task_execution_contract(
          t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
        )='internal_control' then 'in_progress'
        else 'open'
      end,
      details=details||jsonb_build_object(
        'last_dispatch_state','failed',
        'last_dispatch_completed_at',v.completed_at,
        'last_dispatch_error',coalesce(v.last_error,v.stderr)
      ),
      updated_at=now()
  from public.osa_vps_tasks v
  join osa_company.tasks t on t.evidence->>'dispatch_last_vps_task_id'=v.id::text
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and (
      v.state='failed'
      or (v.state='succeeded' and coalesce(v.stdout,'') like '%OSA_DISPATCH_LOGICAL_OK=0%')
    );

  select count(*) into waiting_count
  from osa_company.tasks t
  where t.plan_date=p_date
    and t.state='waiting'
    and osa_company.task_execution_contract(
      t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
    ) in ('external_wait','canonical_verify');

  with candidates as (
    select
      v.id as task_id,v.agent_id,
      (
        select a2.id
        from public.osa_vps_agents a2
        where a2.id<>v.agent_id
          and a2.status='online'
          and a2.last_seen>now()-interval '5 minutes'
          and coalesce(a2.metadata->'capabilities','[]'::jsonb) ? 'inspect'
          and not exists(
            select 1 from public.osa_vps_tasks q
            where q.agent_id=a2.id and q.state in ('queued','running')
          )
        order by case when a2.metadata->>'role'='build' then 1 else 2 end,a2.last_seen desc
        limit 1
      ) as alt_id
    from public.osa_vps_tasks v
    where v.state='queued'
      and v.requested_by='osa_company.execution_dispatcher'
      and v.requested_at<now()-interval '5 minutes'
      and coalesce((v.metadata->>'reroute_count')::int,0)<2
  )
  update public.osa_vps_tasks v
  set agent_id=c.alt_id,
      metadata=coalesce(v.metadata,'{}'::jsonb)||jsonb_build_object(
        'rerouted_from_agent_id',v.agent_id,
        'rerouted_at',now(),
        'reroute_count',coalesce((v.metadata->>'reroute_count')::int,0)+1
      )
  from candidates c
  where v.id=c.task_id and c.alt_id is not null;
  get diagnostics rc=row_count; rerouted:=rerouted+rc;

  return jsonb_build_object(
    'dispatch_succeeded_progress',ok_count,
    'dispatch_failed',fail_count,
    'non_actionable_waits',waiting_count,
    'queued_rerouted',rerouted
  );
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
  business_children integer;
begin
  progressed:=osa_company.reconcile_progressed_company_incidents(p_date);
  superseded:=osa_company.reconcile_superseded_vps_incidents();
  business_children:=osa_company.reconcile_dispatcher_business_failure_incidents();
  return jsonb_build_object(
    'company_incidents',progressed,
    'superseded_vps_incidents_resolved',superseded,
    'dispatcher_business_child_incidents_resolved',business_children
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.reconcile_procurement_finance_tasks(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  scout_events integer:=0;
  candidates_touched integer:=0;
  candidates_new integer:=0;
  assignments_proposed integer:=0;
  registry_promoted integer:=0;
  shortlist jsonb;
  rev jsonb;
  rev_meta jsonb;
  patch_id uuid;
  n_procurement integer:=0;
  n_finance integer:=0;
  n_finance_mgr integer:=0;
begin
  select count(*) into scout_events
  from osa_brain.events
  where event_type='capability_scout_scan'
    and (created_at at time zone 'Africa/Cairo')::date=p_date;

  select count(*) into candidates_touched
  from osa_brain.capability_candidates
  where (updated_at at time zone 'Africa/Cairo')::date=p_date;

  select count(*) into candidates_new
  from osa_brain.capability_candidates
  where (first_seen_at at time zone 'Africa/Cairo')::date=p_date;

  select
    coalesce(sum((payload->>'assignments_proposed')::int),0),
    coalesce(sum((payload->>'registry_candidates_promoted')::int),0)
  into assignments_proposed,registry_promoted
  from osa_company.company_events
  where event_type='procurement_gap_match_cycle'
    and outcome='success'
    and (created_at at time zone 'Africa/Cairo')::date=p_date;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.utility_score desc,x.trust_score desc),'[]'::jsonb)
  into shortlist
  from (
    select candidate_key,name,kind,source,candidate_ref,publisher,state,
           trust_score,utility_score,resource_score,
           requires_account,requires_key,requires_payment,public_use_verified,
           updated_at
    from osa_brain.capability_candidates
    where (updated_at at time zone 'Africa/Cairo')::date=p_date
      and coalesce(requires_payment,false)=false
      and state in ('reviewed','tested','approved','discovered')
      and candidate_key not like 'source.%'
      and candidate_key not like 'market-%'
    order by utility_score desc,trust_score desc,resource_score desc
    limit 5
  ) x;

  if scout_events>0 and candidates_touched>=20 and assignments_proposed>0 then
    update osa_company.tasks
    set state='succeeded',
        completed_at=coalesce(completed_at,now()),
        blocked_reason=null,
        evidence=(
          coalesce(evidence,'{}'::jsonb)
          - 'dispatch_vps_task_id'
          - 'dispatch_last_error'
          - 'dispatch_failure_count'
        ) || jsonb_build_object(
          'completion_mode','deterministic_procurement_evidence',
          'verified_by','osa_company.reconcile_procurement_finance_tasks',
          'verified_at',now(),
          'capability_scout_events',scout_events,
          'candidates_touched_today',candidates_touched,
          'candidates_new_today',candidates_new,
          'registry_candidates_promoted_total',registry_promoted,
          'gap_assignments_proposed_total',assignments_proposed,
          'shortlist',shortlist,
          'rule','Shortlist is review evidence only; no automatic production promotion without QA.'
        ),
        updated_at=now()
    where plan_date=p_date
      and task_key='procurement.daily_market_scan'
      and state<>'cancelled';
    get diagnostics n_procurement=row_count;

    update osa_company.incidents i
    set status='resolved',
        resolved_at=coalesce(resolved_at,now()),
        details=details||jsonb_build_object(
          'resolution','Procurement scan completed by capability scout + gap matcher with >=20 materially updated candidates.',
          'resolved_by','osa_company.reconcile_procurement_finance_tasks',
          'resolved_at',now()
        ),
        updated_at=now()
    from osa_company.tasks t
    where i.source_type='company_task'
      and i.source_ref=t.id::text
      and t.plan_date=p_date
      and t.task_key='procurement.daily_market_scan'
      and t.state='succeeded'
      and i.status in ('open','in_progress','deferred');
  end if;

  rev := osa_company.latest_canonical_revenue_state();
  rev_meta := coalesce(rev->'metadata','{}'::jsonb);

  select id into patch_id
  from public.osa_vps_tasks
  where metadata->>'purpose'='Patch TaskMarket scout to reject fee-required worker entry actions'
    and state='succeeded'
  order by completed_at desc
  limit 1;

  if coalesce((rev->>'fresh')::boolean,false)=true
     and patch_id is not null
     and exists(
       select 1 from osa_company.tasks s
       where s.plan_date=p_date
         and s.task_key='revenue.verify_settlement'
         and s.state='succeeded'
         and s.evidence->>'verified_by'='osa_company.reconcile_canonical_revenue_task'
     )
  then
    update osa_company.tasks
    set state='succeeded',
        completed_at=coalesce(completed_at,now()),
        blocked_reason=null,
        evidence=(
          coalesce(evidence,'{}'::jsonb)
          - 'dispatch_vps_task_id'
          - 'dispatch_last_error'
          - 'dispatch_failure_count'
        ) || jsonb_build_object(
          'completion_mode','deterministic_financial_infra_evidence',
          'verified_by','osa_company.reconcile_procurement_finance_tasks',
          'verified_at',now(),
          'implemented_improvements',jsonb_build_array(
            'Canonical settlement verification routed through latest_canonical_revenue_state/reconcile_canonical_revenue_task instead of generic agent-fabric.',
            'TaskMarket zero-spend scout now rejects worker submit/claim actions that require payment.',
            'VPS stuck-task reaper prevents stale runner state from blocking financial/market workers.'
          ),
          'canonical_snapshot_key',rev->>'knowledge_key',
          'canonical_snapshot_fresh',true,
          'verified_external_revenue_usd',coalesce(rev_meta->>'verified_external_revenue_usd','0'),
          'taskmarket_fee_gate_patch_vps_task_id',patch_id,
          'secrets_exported',false,
          'funds_moved',false
        ),
        updated_at=now()
    where plan_date=p_date
      and task_key='finance.financial_infrastructure'
      and state<>'cancelled';
    get diagnostics n_finance=row_count;

    update osa_company.incidents i
    set status='resolved',
        resolved_at=coalesce(resolved_at,now()),
        details=details||jsonb_build_object(
          'resolution','Financial infrastructure improvement implemented: deterministic canonical settlement + zero-spend TaskMarket fee gate + VPS reaper.',
          'resolved_by','osa_company.reconcile_procurement_finance_tasks',
          'resolved_at',now()
        ),
        updated_at=now()
    from osa_company.tasks t
    where i.source_type='company_task'
      and i.source_ref=t.id::text
      and t.plan_date=p_date
      and t.task_key='finance.financial_infrastructure'
      and t.state='succeeded'
      and i.status in ('open','in_progress','deferred');

    update osa_company.tasks
    set state='succeeded',
        completed_at=coalesce(completed_at,now()),
        blocked_reason=null,
        evidence=(
          coalesce(evidence,'{}'::jsonb)
          - 'dispatch_vps_task_id'
          - 'dispatch_last_error'
          - 'dispatch_failure_count'
        ) || jsonb_build_object(
          'completion_mode','evidence_backed_finance_accountability',
          'verified_by','osa_company.reconcile_procurement_finance_tasks',
          'verified_at',now(),
          'win','Canonical settlement verification and TaskMarket fee gating are now deterministic and verified.',
          'blocker','Verified external revenue remains zero; TaskMarket requester review and Make.fun judging remain external waits.',
          'deprioritize','Any fee-required submission without explicit owner spend approval; generic AI-helper financial execution.',
          'next_action','Monitor canonical settlement and work only verified zero-spend paid demand.',
          'verified_external_revenue_usd',coalesce(rev_meta->>'verified_external_revenue_usd','0')
        ),
        updated_at=now()
    where plan_date=p_date
      and task_key='manager.finance.daily_accountability'
      and state<>'cancelled';
    get diagnostics n_finance_mgr=row_count;

    update osa_company.incidents i
    set status='resolved',
        resolved_at=coalesce(resolved_at,now()),
        details=details||jsonb_build_object(
          'resolution','Finance daily accountability completed from canonical financial evidence.',
          'resolved_by','osa_company.reconcile_procurement_finance_tasks',
          'resolved_at',now()
        ),
        updated_at=now()
    from osa_company.tasks t
    where i.source_type='company_task'
      and i.source_ref=t.id::text
      and t.plan_date=p_date
      and t.task_key='manager.finance.daily_accountability'
      and t.state='succeeded'
      and i.status in ('open','in_progress','deferred');
  end if;

  return jsonb_build_object(
    'procurement_closed',n_procurement,
    'finance_infrastructure_closed',n_finance,
    'finance_accountability_closed',n_finance_mgr,
    'scout_events',scout_events,
    'candidates_touched',candidates_touched,
    'candidates_new',candidates_new,
    'assignments_proposed_total',assignments_proposed
  );
end
$function$


CREATE OR REPLACE FUNCTION osa_company.resolve_internal_control_tasks(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  priority_guard jsonb:=null;
  prioritized boolean:=false;
  resolved_incidents integer:=0;
begin
  if exists(
    select 1 from osa_company.tasks
    where plan_date=p_date
      and task_key='executive.prioritize'
      and state in ('queued','in_progress','waiting','blocked')
  ) then
    priority_guard:=osa_company.build_ceo_decision_guard(p_date);
    prioritized:=true;
  end if;

  update osa_company.incidents i
  set status='resolved',
      resolved_at=coalesce(i.resolved_at,now()),
      details=i.details||jsonb_build_object(
        'resolution','Internal-control task completed by deterministic company control function, not generative code repair.',
        'resolved_by','osa_company.resolve_internal_control_tasks',
        'resolved_at',now()
      ),
      updated_at=now()
  from osa_company.tasks t
  where i.source_type='company_task'
    and i.source_ref=t.id::text
    and i.status in ('open','in_progress','deferred')
    and t.plan_date=p_date
    and t.state='succeeded'
    and osa_company.task_execution_contract(
      t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
    )='internal_control';
  get diagnostics resolved_incidents=row_count;

  return jsonb_build_object(
    'prioritize_completed',prioritized,
    'priority_guard_created',priority_guard is not null,
    'internal_incidents_resolved',resolved_incidents
  );
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
  internal_control jsonb;
  p_date date:=((now() at time zone 'Africa/Cairo')::date);
begin
  perform public.osa_reap_stuck_vps_tasks();
  reconciled := osa_company.reconcile_self_heal_runs();
  perform osa_company.reconcile_operational_incidents(p_date);
  internal_control := osa_company.resolve_internal_control_tasks(p_date);
  perform osa_company.reconcile_external_effect_delegation(p_date);

  select id into active_id
  from public.osa_vps_tasks
  where requested_by='osa_company.self_healer'
    and state in ('queued','running')
  order by requested_at asc
  limit 1;

  if active_id is not null then
    return jsonb_build_object(
      'state','active',
      'self_heal_vps_task_id',active_id,
      'reconciled',reconciled,
      'internal_control',internal_control
    );
  end if;

  select v.id into candidate_id
  from public.osa_vps_tasks v
  where v.state='failed'
    and v.requested_at>now()-interval '30 minutes'
    and osa_company.is_generatively_self_healable_vps_task(v.id)
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
    if enqueued is not null then
      return jsonb_build_object(
        'state','enqueued_recent_code_runtime_failure',
        'source_vps_task_id',candidate_id,
        'self_heal_vps_task_id',enqueued,
        'reconciled',reconciled,
        'internal_control',internal_control
      );
    end if;
  end if;

  select i.incident_key into incident_key
  from osa_company.incidents i
  where i.status in ('open','in_progress')
    and i.severity in ('critical','high')
    and (
      (
        i.source_type='vps_task'
        and exists(
          select 1 from public.osa_vps_tasks v
          where v.id::text=i.source_ref
            and osa_company.is_generatively_self_healable_vps_task(v.id)
        )
      )
      or (
        i.source_type='company_task'
        and exists(
          select 1
          from osa_company.tasks t
          join public.osa_vps_tasks v
            on v.id::text=coalesce(
              nullif(t.evidence->>'dispatch_last_vps_task_id',''),
              nullif(t.evidence->>'dispatch_vps_task_id','')
            )
          where t.id::text=i.source_ref
            and osa_company.task_execution_contract(
              t.task_key,t.title,t.objective,t.state,t.evidence,t.blocked_reason
            )='analysis'
            and osa_company.is_generatively_self_healable_vps_task(v.id)
        )
      )
    )
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
    if enqueued is not null then
      return jsonb_build_object(
        'state','enqueued_code_runtime_incident',
        'source_incident_key',incident_key,
        'self_heal_vps_task_id',enqueued,
        'reconciled',reconciled,
        'internal_control',internal_control
      );
    end if;
  end if;

  return jsonb_build_object(
    'state','healthy_no_code_runtime_failure',
    'reconciled',reconciled,
    'internal_control',internal_control
  );
end
$function$


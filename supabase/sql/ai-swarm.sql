-- OSA multi-model swarm persistence.
-- Prerequisite: the osa_brain schema, model_catalog, events, lessons, and Vault helpers
-- already exist in the target project.

create table if not exists osa_brain.swarm_runs (
  id uuid primary key default gen_random_uuid(),
  objective text not null,
  domain text not null default 'general',
  mode text not null default 'research'
    check (mode in ('research','solve','review','compare')),
  requested_agents integer not null default 4
    check (requested_agents between 1 and 12),
  state text not null default 'queued'
    check (state in ('queued','running','succeeded','partial','failed')),
  preferred_provider text,
  plan jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists osa_brain.swarm_members (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references osa_brain.swarm_runs(id) on delete cascade,
  agent_index integer not null,
  role text not null,
  route_key text,
  provider text,
  model text,
  state text not null default 'queued'
    check (state in ('queued','running','succeeded','failed','handoff')),
  prompt text not null,
  output text,
  latency_ms integer,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, agent_index)
);

create index if not exists swarm_runs_created_at_idx
  on osa_brain.swarm_runs(created_at desc);
create index if not exists swarm_runs_state_idx
  on osa_brain.swarm_runs(state, created_at desc);
create index if not exists swarm_members_run_idx
  on osa_brain.swarm_members(run_id, agent_index);

alter table osa_brain.swarm_runs enable row level security;
alter table osa_brain.swarm_members enable row level security;

revoke all on osa_brain.swarm_runs from public, anon, authenticated;
revoke all on osa_brain.swarm_members from public, anon, authenticated;

insert into osa_brain.model_catalog
(route_key, provider, model, model_class, execution_mode, capabilities,
 quality_prior, speed_prior, cost_prior, enabled, metadata)
values
(
  'anthropic:claude-fable-5',
  'anthropic',
  'claude-fable-5',
  'maximum',
  'automatic',
  '{"text":true,"coding":true,"reasoning":"maximum","long_horizon":true,"agentic":true}'::jsonb,
  0.995, 0.42, 0.08, true,
  '{"role":"deep_research_and_long_horizon_agent"}'::jsonb
),
(
  'anthropic:claude-opus-5',
  'anthropic',
  'claude-opus-5',
  'maximum',
  'automatic',
  '{"text":true,"coding":true,"reasoning":"high","agentic":true}'::jsonb,
  0.97, 0.55, 0.20, true,
  '{"role":"deep_reasoning"}'::jsonb
),
(
  'anthropic:claude-sonnet-5',
  'anthropic',
  'claude-sonnet-5',
  'balanced',
  'automatic',
  '{"text":true,"coding":true,"reasoning":"high","agentic":true}'::jsonb,
  0.91, 0.78, 0.55, true,
  '{"role":"balanced_agent"}'::jsonb
),
(
  'anthropic:claude-haiku-4-5',
  'anthropic',
  'claude-haiku-4-5',
  'fast',
  'automatic',
  '{"text":true,"coding":true,"reasoning":"medium","agentic":true}'::jsonb,
  0.82, 0.98, 0.90, true,
  '{"role":"fast_scout_and_triage"}'::jsonb
)
on conflict(route_key) do update set
  provider = excluded.provider,
  model = excluded.model,
  model_class = excluded.model_class,
  execution_mode = excluded.execution_mode,
  capabilities = excluded.capabilities,
  quality_prior = excluded.quality_prior,
  speed_prior = excluded.speed_prior,
  cost_prior = excluded.cost_prior,
  enabled = true,
  metadata = osa_brain.model_catalog.metadata || excluded.metadata,
  updated_at = now();

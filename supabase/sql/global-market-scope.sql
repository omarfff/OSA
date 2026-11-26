-- OSA worldwide market scope.
-- Owner-authorized non-financial execution is global by default.
-- Financial spend, identity/KYC, new debt/credit, third-party fund transfers,
-- sanctions/platform-access circumvention, and private-key/seed export remain gated.

update osa_company.company_state
set metadata = metadata
  || jsonb_build_object(
    'global_market_scope', jsonb_build_object(
      'enabled', true,
      'mode', 'worldwide_all_countries',
      'countries', jsonb_build_array('*'),
      'default_country_filter', 'none',
      'saudi_egypt_priority_only', false,
      'search_worldwide_by_default', true,
      'cross_border_opportunities', true,
      'multilingual_discovery', true,
      'updated_at', now()
    )
  ),
  updated_at=now()
where singleton=true;

create or replace function osa_company.enforce_global_market_scope_on_task()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  directive constant text :=
    ' GLOBAL SCOPE: search and act worldwide across all countries and regions; do not prefer Egypt or Saudi Arabia unless evidence ranks them highest. Geography may filter only for applicable law, platform eligibility/terms, payout availability, language/capability fit, owner friction, and time-to-cash.';
begin
  if (
    new.division_id in ('revenue','procurement','intelligence')
    or new.task_key='executive.market_ecosystem_governance'
  ) then
    if position('GLOBAL SCOPE:' in coalesce(new.objective,''))=0 then
      new.objective := coalesce(new.objective,'') || directive;
    end if;
    new.evidence := coalesce(new.evidence,'{}'::jsonb)||jsonb_build_object(
      'geographic_scope','global',
      'country_filter','none',
      'worldwide_authorized',true
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_tasks_global_market_scope on osa_company.tasks;
create trigger trg_tasks_global_market_scope
before insert or update of objective,division_id,task_key
on osa_company.tasks
for each row
execute function osa_company.enforce_global_market_scope_on_task();

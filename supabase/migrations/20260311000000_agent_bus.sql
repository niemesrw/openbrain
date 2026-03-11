-- Enable pgcrypto for gen_random_bytes
create extension if not exists pgcrypto with schema extensions;

-- Agent keys table for multi-agent authentication
create table agent_keys (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null unique,
  api_key text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz default now()
);

create index on agent_keys (api_key);

alter table agent_keys enable row level security;

create policy "Service role full access"
  on agent_keys
  for all
  using (auth.role() = 'service_role');

-- Seed the existing personal key
insert into agent_keys (agent_name, api_key)
values ('personal', 'a74ab05daf2ec7ad928ddfe7142c069eed5d9b9f3eaba13904f25c163d993003');

-- Bus activity function: returns agent activity summary as JSON
create or replace function bus_activity(
  hours_back int default 24,
  agent_filter text default null,
  result_limit int default 20
)
returns jsonb
language plpgsql
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => hours_back);
  result jsonb;
begin
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'total_thoughts', count(*),
        'active_agents', count(distinct t.metadata->>'agent_id'),
        'hours', hours_back
      )
      from thoughts t
      where t.created_at >= cutoff
        and (agent_filter is null or t.metadata->>'agent_id' = agent_filter)
    ),
    'by_agent', coalesce((
      select jsonb_agg(row_to_json(a)::jsonb)
      from (
        select
          t.metadata->>'agent_id' as agent,
          count(*) as thought_count,
          max(t.created_at) as last_active
        from thoughts t
        where t.created_at >= cutoff
          and (agent_filter is null or t.metadata->>'agent_id' = agent_filter)
        group by t.metadata->>'agent_id'
        order by count(*) desc
      ) a
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb)
      from (
        select
          t.content,
          t.metadata->>'agent_id' as agent,
          t.metadata->>'type' as type,
          t.metadata->'topics' as topics,
          t.created_at
        from thoughts t
        where t.created_at >= cutoff
          and (agent_filter is null or t.metadata->>'agent_id' = agent_filter)
        order by t.created_at desc
        limit result_limit
      ) r
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

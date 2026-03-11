-- Server-side stats aggregation (avoids PostgREST 1000-row default limit)
create or replace function stats_summary()
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'total', (select count(*) from thoughts),
    'earliest', (select min(created_at) from thoughts),
    'types', (
      select coalesce(json_object_agg(t.type_val, t.cnt), '{}')
      from (
        select metadata->>'type' as type_val, count(*) as cnt
        from thoughts
        where metadata->>'type' is not null
        group by metadata->>'type'
        order by cnt desc
      ) t
    ),
    'topics', (
      select coalesce(json_object_agg(t.topic, t.cnt), '{}')
      from (
        select topic, count(*) as cnt
        from thoughts, jsonb_array_elements_text(metadata->'topics') as topic
        group by topic
        order by cnt desc
      ) t
    ),
    'people', (
      select coalesce(json_object_agg(p.person, p.cnt), '{}')
      from (
        select person, count(*) as cnt
        from thoughts, jsonb_array_elements_text(metadata->'people') as person
        group by person
        order by cnt desc
      ) p
    )
  ) into result;

  return result;
end;
$$;

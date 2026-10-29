create or replace function __SCHEMA__.enqueue(jobs jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; current_message jsonb; ids uuid[]:='{}'; settings __SCHEMA__.settings%rowtype; existing __SCHEMA__.deliveries%rowtype;
begin
  select * into settings from __SCHEMA__.settings where setting_id for share;
  if jsonb_typeof(jobs) is distinct from 'array' or jsonb_array_length(jobs) not between 1 and 1000 then raise exception 'Expected 1 to 1000 jobs' using errcode='22023'; end if;
  for job in select value from jsonb_array_elements(jobs) loop
    current_message:=job->'message';
    if jsonb_typeof(job) is distinct from 'object' or job-array['message','context']<>'{}'::jsonb or __SCHEMA__.validate_message(current_message) is not true or
      (job ? 'context' and (jsonb_typeof(job->'context') is distinct from 'object' or octet_length((job->'context')::text)>16384)) then raise exception 'Invalid current_message' using errcode='22023'; end if;
    if (settings.provider='brevo' and current_message->'content'->>'kind'<>'template') or (settings.provider='smtp' and current_message->'content'->>'kind'<>'rendered') then raise exception 'Unsupported current_message content' using errcode='22023'; end if;
    if (current_message->>'id')::uuid=any(ids) then raise exception 'Duplicate current_message ID' using errcode='22023'; end if;
    ids:=array_append(ids,(current_message->>'id')::uuid);
    insert into __SCHEMA__.deliveries(delivery_id,message,context,provider,transport)
      values((current_message->>'id')::uuid,current_message,coalesce(job->'context','{}'),settings.provider,settings.transport)
      on conflict(delivery_id) do nothing;
    select * into existing from __SCHEMA__.deliveries d where d.delivery_id=(current_message->>'id')::uuid;
    if existing.message is distinct from current_message or existing.context is distinct from coalesce(job->'context','{}'::jsonb) then raise exception 'Message ID already has different content' using errcode='22023'; end if;
  end loop;
  return to_jsonb(ids);
end;
$$;

create function __SCHEMA__.service_status(input jsonb) returns jsonb language sql stable security definer set search_path='' as $$
select __SCHEMA__.delivery_status((input #>> '{}')::uuid);
$$;
revoke all on function __SCHEMA__.service_status(jsonb) from public,anon,authenticated,service_role;
insert into sc_services.bindings(service_name,operation,implementation,contract_version,handler)
values('transactional_email','status','supacharger-ext-transactional-email',1,'__SCHEMA__.service_status(jsonb)')
on conflict(service_name,operation) do update set implementation=excluded.implementation,contract_version=excluded.contract_version,handler=excluded.handler;

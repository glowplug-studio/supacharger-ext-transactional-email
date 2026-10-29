-- Generated from validated installation parameters. Keep applied migration history immutable.
create schema __SCHEMA__;
revoke all on schema __SCHEMA__ from public,anon,authenticated,service_role;
create table __SCHEMA__.settings (
  setting_id boolean primary key default true check(setting_id),
  provider text not null, transport text not null, enabled boolean not null default false,
  check((provider,transport) in (('brevo','api'),('resend','api'),('mailgun','api'),('smtp','smtp')))
);
insert into __SCHEMA__.settings(provider,transport) values ('__PROVIDER__','__TRANSPORT__');
create table __SCHEMA__.deliveries (
  delivery_id uuid primary key,
  message jsonb not null,
  context jsonb not null default '{}',
  resolved_message jsonb,
  provider text not null, transport text not null,
  status text not null default 'queued' check(status in ('queued','claimed','accepted','blocked','retryable','uncertain')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
  lease_token uuid, claimed_until timestamptz, accepted_at timestamptz,
  reason text, provider_reference text,
  check(jsonb_typeof(context)='object' and octet_length(context::text)<=16384)
);
create index deliveries_pending on __SCHEMA__.deliveries(next_attempt_at,created_at) where status in ('queued','retryable');
create table __SCHEMA__.resolvers (
  resolver_id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  handler regprocedure not null
);
alter table __SCHEMA__.settings enable row level security;
alter table __SCHEMA__.deliveries enable row level security;
alter table __SCHEMA__.resolvers enable row level security;
revoke all on all tables in schema __SCHEMA__ from public,anon,authenticated,service_role;

create function __SCHEMA__.validate_message(message jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare recipient jsonb; content jsonb;
begin
  if jsonb_typeof(message) is distinct from 'object' or octet_length(message::text)>100000 or
    message-array['id','to','content','replyTo']<>'{}'::jsonb or
    coalesce(message->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  for recipient in select message->'to' union all select message->'replyTo' where message ? 'replyTo' loop
    if jsonb_typeof(recipient) is distinct from 'object' or recipient-array['email','name']<>'{}'::jsonb or
      jsonb_typeof(recipient->'email') is distinct from 'string' or
      coalesce(recipient->>'email','') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' or length(recipient->>'email')>254 or
      (recipient ? 'name' and (jsonb_typeof(recipient->'name') is distinct from 'string' or length(recipient->>'name')>200 or recipient->>'name' ~ E'[\r\n]')) then return false; end if;
  end loop;
  content:=message->'content';
  if jsonb_typeof(content) is distinct from 'object' then return false; end if;
  if content->>'kind'='template' then
    return content-array['kind','key','variables']='{}'::jsonb and coalesce(content->>'key','') ~ '^[A-Z][A-Z0-9_]{0,63}$' and jsonb_typeof(content->'variables')='object';
  elsif content->>'kind'='rendered' then
    return content-array['kind','subject','html','text']='{}'::jsonb and jsonb_typeof(content->'subject')='string'
      and length(content->>'subject') between 1 and 998 and content->>'subject' !~ E'[\r\n]'
      and (not content ? 'html' or (jsonb_typeof(content->'html')='string' and length(content->>'html') between 1 and 90000))
      and (not content ? 'text' or (jsonb_typeof(content->'text')='string' and length(content->>'text') between 1 and 90000))
      and (content ? 'html' or content ? 'text');
  end if;
  return false;
end;
$$;

create function __SCHEMA__.enqueue(jobs jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; message jsonb; ids uuid[]:='{}'; settings __SCHEMA__.settings%rowtype; existing __SCHEMA__.deliveries%rowtype;
begin
  select * into settings from __SCHEMA__.settings where setting_id for share;
  if jsonb_typeof(jobs) is distinct from 'array' or jsonb_array_length(jobs) not between 1 and 1000 then raise exception 'Expected 1 to 1000 jobs' using errcode='22023'; end if;
  for job in select value from jsonb_array_elements(jobs) loop
    message:=job->'message';
    if jsonb_typeof(job) is distinct from 'object' or job-array['message','context']<>'{}'::jsonb or __SCHEMA__.validate_message(message) is not true or
      (job ? 'context' and (jsonb_typeof(job->'context') is distinct from 'object' or octet_length((job->'context')::text)>16384)) then raise exception 'Invalid message' using errcode='22023'; end if;
    if (settings.provider='brevo' and message->'content'->>'kind'<>'template') or (settings.provider='smtp' and message->'content'->>'kind'<>'rendered') then raise exception 'Unsupported message content' using errcode='22023'; end if;
    if (message->>'id')::uuid=any(ids) then raise exception 'Duplicate message ID' using errcode='22023'; end if;
    ids:=array_append(ids,(message->>'id')::uuid);
    insert into __SCHEMA__.deliveries(delivery_id,message,context,provider,transport)
      values((message->>'id')::uuid,message,coalesce(job->'context','{}'),settings.provider,settings.transport)
      on conflict(delivery_id) do nothing;
    select * into existing from __SCHEMA__.deliveries d where d.delivery_id=(message->>'id')::uuid;
    if existing.message is distinct from message or existing.context is distinct from coalesce(job->'context','{}'::jsonb) then raise exception 'Message ID already has different content' using errcode='22023'; end if;
  end loop;
  return to_jsonb(ids);
end;
$$;
create function __SCHEMA__.enqueue_messages(messages jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(messages) is distinct from 'array' then raise exception 'Expected messages' using errcode='22023'; end if;
  return __SCHEMA__.enqueue((select jsonb_agg(jsonb_build_object('message',value)) from jsonb_array_elements(messages)));
end;
$$;
create function api_edge.__RPC__enqueue(messages jsonb) returns jsonb language sql security definer set search_path='' as $$ select __SCHEMA__.enqueue_messages(messages); $$;

create function __SCHEMA__.dispatch(delivery_ids uuid[] default null) returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text;
begin
  if not exists(select 1 from __SCHEMA__.settings where enabled) then return; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='__SCHEMA___worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name='__SCHEMA___worker_secret';
  if endpoint is null or secret is null or length(secret)<32 then return; end if;
  if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/__WORKER__$' then raise exception 'Invalid worker endpoint'; end if;
  perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    body:=jsonb_build_object('action','process')||case when delivery_ids is null then '{}'::jsonb else jsonb_build_object('ids',delivery_ids) end,timeout_milliseconds:=60000);
exception when others then raise warning 'Email dispatcher unavailable; jobs remain queued';
end;
$$;
create function __SCHEMA__.dispatch_inserted() returns trigger language plpgsql security definer set search_path='' as $$
begin perform __SCHEMA__.dispatch(); return null; end;
$$;
create trigger dispatch_inserted after insert on __SCHEMA__.deliveries for each statement execute function __SCHEMA__.dispatch_inserted();

create function api_edge.__RPC__configuration() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object('provider',provider,'transport',transport,'enabled',enabled) from __SCHEMA__.settings where setting_id;
$$;
create function api_edge.__RPC__claim(delivery_ids uuid[], expected_provider text, expected_transport text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job __SCHEMA__.deliveries%rowtype; handler record; refreshed jsonb; result jsonb:='[]'; token uuid;
begin
  if not exists(select 1 from __SCHEMA__.settings where enabled and provider=expected_provider and transport=expected_transport) then raise exception 'Worker selection unavailable' using errcode='55000'; end if;
  if delivery_ids is not null and (cardinality(delivery_ids)<1 or cardinality(delivery_ids)>20) then raise exception 'Invalid batch' using errcode='22023'; end if;
  -- A crashed sender may have reached the provider. Never automatically reclaim it.
  update __SCHEMA__.deliveries set status='uncertain',reason='expired_lease',lease_token=null,claimed_until=null where status='claimed' and claimed_until<clock_timestamp();
  for job in select * from __SCHEMA__.deliveries d where d.status in ('queued','retryable') and d.next_attempt_at<=clock_timestamp()
    and d.provider=expected_provider and d.transport=expected_transport and (delivery_ids is null or d.delivery_id=any(delivery_ids))
    order by d.created_at,d.delivery_id limit 20 for update skip locked loop
    refreshed:=job.message;
    select p.*,n.nspname into handler from __SCHEMA__.resolvers r join pg_proc p on p.oid=r.handler::oid join pg_namespace n on n.oid=p.pronamespace
      where r.template_key=job.message->'content'->>'key';
    if found then
      if handler.prokind<>'f' or handler.proretset or handler.pronargs<>1 or handler.proargtypes<>'3802'::oidvector or handler.prorettype<>'jsonb'::regtype or handler.provariadic<>0 or handler.pronargdefaults<>0 or handler.nspname in ('public','api','api_edge','mcp_api') then raise exception 'Invalid resolver'; end if;
      execute format('select %I.%I($1)',handler.nspname,handler.proname) into refreshed using jsonb_build_object('message',job.message,'context',job.context);
    elsif job.context<>'{}'::jsonb then refreshed:=null;
    end if;
    if __SCHEMA__.validate_message(refreshed) is not true or refreshed->>'id' is distinct from job.message->>'id' or
      (job.resolved_message is not null and job.resolved_message is distinct from refreshed) then
      update __SCHEMA__.deliveries set status='blocked',reason='recipient_or_content_changed' where delivery_id=job.delivery_id;
      continue;
    end if;
    token:=gen_random_uuid();
    update __SCHEMA__.deliveries set status='claimed',resolved_message=refreshed,attempts=attempts+1,lease_token=token,claimed_until=clock_timestamp()+interval '2 minutes' where delivery_id=job.delivery_id;
    result:=result||jsonb_build_array(jsonb_build_object('delivery_id',job.delivery_id,'message',refreshed,'lease_token',token));
  end loop;
  return result;
end;
$$;
create function api_edge.__RPC__finish(delivery_id uuid, lease_token uuid, outcome jsonb) returns void language plpgsql security definer set search_path='' as $$
declare state text:=outcome->>'state'; delay_seconds integer:=coalesce((outcome->>'retryAfter')::integer,60);
begin
  if jsonb_typeof(outcome) is distinct from 'object' or state is null or state not in ('accepted','retryable','blocked','uncertain') or
    outcome-array['state','reason','reference','retryAfter']<>'{}'::jsonb or coalesce(outcome->>'reason','') !~ '^[a-z_]{1,64}$' or
    (outcome ? 'reference' and (jsonb_typeof(outcome->'reference') is distinct from 'string' or length(outcome->>'reference')>500)) or delay_seconds not between 1 and 86400 then raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  update __SCHEMA__.deliveries d set status=case when state='retryable' and attempts>=8 then 'blocked' else state end,
    reason=case when state='retryable' and attempts>=8 then 'retry_limit' else outcome->>'reason' end, provider_reference=outcome->>'reference',
    accepted_at=case when state='accepted' then clock_timestamp() else null end, lease_token=null,claimed_until=null,
    next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(delay_seconds,least(3600,60*power(2,least(attempts,6)))::integer))
    where d.delivery_id=__RPC__finish.delivery_id and d.lease_token=__RPC__finish.lease_token and d.status='claimed';
  if not found then raise exception 'Stale delivery lease' using errcode='22023'; end if;
end;
$$;
create function api_edge.__RPC__retry(delivery_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  if delivery_ids is null or cardinality(delivery_ids) not between 1 and 20 or cardinality(delivery_ids)<>(select count(distinct id) from unnest(delivery_ids) id) then raise exception 'Invalid selection' using errcode='22023'; end if;
  perform 1 from __SCHEMA__.deliveries d where d.delivery_id=any(delivery_ids) for update;
  select count(*) into total from __SCHEMA__.deliveries d where d.delivery_id=any(delivery_ids) and d.status='blocked' and d.reason in ('template_missing','template_inactive','template_not_configured','credentials_rejected','sender_not_configured');
  if total<>cardinality(delivery_ids) then raise exception 'Only repairable blocked deliveries may be retried' using errcode='22023'; end if;
  update __SCHEMA__.deliveries d set status='queued',next_attempt_at=now(),reason=null where d.delivery_id=any(delivery_ids);
end;
$$;
create function __SCHEMA__.delivery_status(delivery_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('status',status,'reason',reason,'provider_reference',provider_reference) from __SCHEMA__.deliveries d where d.delivery_id=delivery_status.delivery_id;
$$;
revoke all on all functions in schema __SCHEMA__ from public,anon,authenticated,service_role;
revoke all on function api_edge.__RPC__enqueue(jsonb), api_edge.__RPC__configuration(), api_edge.__RPC__claim(uuid[],text,text), api_edge.__RPC__finish(uuid,uuid,jsonb), api_edge.__RPC__retry(uuid[]) from public,anon,authenticated;
grant execute on function api_edge.__RPC__enqueue(jsonb), api_edge.__RPC__configuration(), api_edge.__RPC__claim(uuid[],text,text), api_edge.__RPC__finish(uuid,uuid,jsonb), api_edge.__RPC__retry(uuid[]) to service_role;
insert into sc_services.bindings(service_name,operation,implementation,contract_version,handler) values
 ('transactional_email','enqueue','supacharger-ext-transactional-email',1,'__SCHEMA__.enqueue_messages(jsonb)'),
 ('transactional_email','enqueue_context','supacharger-ext-transactional-email',1,'__SCHEMA__.enqueue(jsonb)')
on conflict(service_name,operation) do update set implementation=excluded.implementation,contract_version=excluded.contract_version,handler=excluded.handler;
select cron.schedule('__SCHEMA___recovery','* * * * *','select __SCHEMA__.dispatch()');
notify pgrst,'reload schema';

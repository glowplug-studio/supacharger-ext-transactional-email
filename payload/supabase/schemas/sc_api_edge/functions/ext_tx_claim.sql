CREATE OR REPLACE FUNCTION sc_api_edge.ext_tx_claim (
  delivery_ids       uuid[],
  expected_provider  text,
  expected_transport text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare job sc_ext_transactional_email.deliveries%rowtype; handler record; refreshed jsonb; result jsonb:='[]'; token uuid;
begin
  if not exists(select 1 from sc_ext_transactional_email.settings where enabled and provider=expected_provider and transport=expected_transport) then raise exception 'Worker selection unavailable' using errcode='55000'; end if;
  if delivery_ids is not null and (cardinality(delivery_ids)<1 or cardinality(delivery_ids)>20) then raise exception 'Invalid batch' using errcode='22023'; end if;
  -- A crashed sender may have reached the provider. Never automatically reclaim it.
  update sc_ext_transactional_email.deliveries set status='uncertain',reason='expired_lease',lease_token=null,claimed_until=null where status='claimed' and claimed_until<clock_timestamp();
  for job in select * from sc_ext_transactional_email.deliveries d where d.status in ('queued','retryable') and d.next_attempt_at<=clock_timestamp()
    and d.provider=expected_provider and d.transport=expected_transport and (delivery_ids is null or d.delivery_id=any(delivery_ids))
    order by d.created_at,d.delivery_id limit 20 for update skip locked loop
    refreshed:=job.message;
    select p.*,n.nspname into handler from sc_ext_transactional_email.resolvers r join pg_proc p on p.oid=r.handler::oid join pg_namespace n on n.oid=p.pronamespace
      where r.template_key=job.message->'content'->>'key';
    if found then
      if handler.prokind<>'f' or handler.proretset or handler.pronargs<>1 or handler.proargtypes<>'3802'::oidvector or handler.prorettype<>'jsonb'::regtype or handler.provariadic<>0 or handler.pronargdefaults<>0 or handler.nspname in ('public','sc_api','sc_api_edge','sc_mcp_api') then raise exception 'Invalid resolver'; end if;
      execute format('select %I.%I($1)',handler.nspname,handler.proname) into refreshed using jsonb_build_object('message',job.message,'context',job.context);
    elsif job.context<>'{}'::jsonb then refreshed:=null;
    end if;
    if sc_ext_transactional_email.validate_message(refreshed) is not true or refreshed->>'id' is distinct from job.message->>'id' or
      (job.resolved_message is not null and job.resolved_message is distinct from refreshed) then
      update sc_ext_transactional_email.deliveries set status='blocked',reason='recipient_or_content_changed' where delivery_id=job.delivery_id;
      continue;
    end if;
    token:=gen_random_uuid();
    update sc_ext_transactional_email.deliveries set status='claimed',resolved_message=refreshed,attempts=attempts+1,lease_token=token,claimed_until=clock_timestamp()+interval '2 minutes' where delivery_id=job.delivery_id;
    result:=result||jsonb_build_array(jsonb_build_object('delivery_id',job.delivery_id,'message',refreshed,'lease_token',token));
  end loop;
  return result;
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_api_edge"."ext_tx_claim"(uuid[], text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "sc_api_edge"."ext_tx_claim"(uuid[], text, text) FROM PUBLIC;

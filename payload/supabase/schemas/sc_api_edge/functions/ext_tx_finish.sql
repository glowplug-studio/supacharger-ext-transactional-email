CREATE OR REPLACE FUNCTION sc_api_edge.ext_tx_finish (
  delivery_id uuid,
  lease_token uuid,
  outcome     jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare state text:=outcome->>'state'; delay_seconds integer:=coalesce((outcome->>'retryAfter')::integer,60);
begin
  if jsonb_typeof(outcome) is distinct from 'object' or state is null or state not in ('accepted','retryable','blocked','uncertain') or
    outcome-array['state','reason','reference','retryAfter']<>'{}'::jsonb or coalesce(outcome->>'reason','') !~ '^[a-z_]{1,64}$' or
    (outcome ? 'reference' and (jsonb_typeof(outcome->'reference') is distinct from 'string' or length(outcome->>'reference')>500)) or delay_seconds not between 1 and 86400 then raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  update sc_ext_transactional_email.deliveries d set status=case when state='retryable' and attempts>=8 then 'blocked' else state end,
    reason=case when state='retryable' and attempts>=8 then 'retry_limit' else outcome->>'reason' end, provider_reference=outcome->>'reference',
    accepted_at=case when state='accepted' then clock_timestamp() else null end, lease_token=null,claimed_until=null,
    next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(delay_seconds,least(3600,60*power(2,least(attempts,6)))::integer))
    where d.delivery_id=ext_tx_finish.delivery_id and d.lease_token=ext_tx_finish.lease_token and d.status='claimed';
  if not found then raise exception 'Stale delivery lease' using errcode='22023'; end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_api_edge"."ext_tx_finish"(uuid, uuid, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "sc_api_edge"."ext_tx_finish"(uuid, uuid, jsonb) FROM PUBLIC;

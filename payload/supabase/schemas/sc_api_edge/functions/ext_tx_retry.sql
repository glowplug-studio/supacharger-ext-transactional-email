CREATE OR REPLACE FUNCTION sc_api_edge.ext_tx_retry (
  delivery_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare total integer;
begin
  if delivery_ids is null or cardinality(delivery_ids) not between 1 and 20 or cardinality(delivery_ids)<>(select count(distinct id) from unnest(delivery_ids) id) then raise exception 'Invalid selection' using errcode='22023'; end if;
  perform 1 from sc_ext_transactional_email.deliveries d where d.delivery_id=any(delivery_ids) for update;
  select count(*) into total from sc_ext_transactional_email.deliveries d where d.delivery_id=any(delivery_ids) and d.status='blocked' and d.reason in ('template_missing','template_inactive','template_not_configured','credentials_rejected','sender_not_configured');
  if total<>cardinality(delivery_ids) then raise exception 'Only repairable blocked deliveries may be retried' using errcode='22023'; end if;
  update sc_ext_transactional_email.deliveries d set status='queued',next_attempt_at=now(),reason=null where d.delivery_id=any(delivery_ids);
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_api_edge"."ext_tx_retry"(uuid[]) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "sc_api_edge"."ext_tx_retry"(uuid[]) FROM PUBLIC;

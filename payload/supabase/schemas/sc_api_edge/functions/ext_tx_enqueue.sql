CREATE OR REPLACE FUNCTION sc_api_edge.ext_tx_enqueue (
  messages jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$ select sc_ext_transactional_email.enqueue_messages(messages); $function$;

GRANT EXECUTE ON FUNCTION "sc_api_edge"."ext_tx_enqueue"(jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "sc_api_edge"."ext_tx_enqueue"(jsonb) FROM PUBLIC;

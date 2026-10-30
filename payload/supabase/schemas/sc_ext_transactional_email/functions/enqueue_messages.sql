CREATE OR REPLACE FUNCTION sc_ext_transactional_email.enqueue_messages (
  messages jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if jsonb_typeof(messages) is distinct from 'array' then raise exception 'Expected messages' using errcode='22023'; end if;
  return sc_ext_transactional_email.enqueue((select jsonb_agg(jsonb_build_object('message',value)) from jsonb_array_elements(messages)));
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."enqueue_messages"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."enqueue_messages"(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION sc_ext_transactional_email.service_status (
  input jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
select sc_ext_transactional_email.delivery_status((input #>> '{}')::uuid);
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."service_status"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."service_status"(jsonb) FROM PUBLIC;

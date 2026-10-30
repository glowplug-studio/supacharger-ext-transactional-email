CREATE OR REPLACE FUNCTION sc_api_edge.ext_tx_configuration()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
select jsonb_build_object('provider',provider,'transport',transport,'enabled',enabled) from sc_ext_transactional_email.settings where setting_id;
$function$;

GRANT EXECUTE ON FUNCTION "sc_api_edge"."ext_tx_configuration"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "sc_api_edge"."ext_tx_configuration"() FROM PUBLIC;

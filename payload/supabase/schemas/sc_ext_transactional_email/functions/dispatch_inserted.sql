CREATE OR REPLACE FUNCTION sc_ext_transactional_email.dispatch_inserted()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin perform sc_ext_transactional_email.dispatch(); return null; end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."dispatch_inserted"() TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."dispatch_inserted"() FROM PUBLIC;

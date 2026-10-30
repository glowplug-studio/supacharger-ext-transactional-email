CREATE OR REPLACE FUNCTION sc_ext_transactional_email.delivery_status (
  delivery_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
select jsonb_build_object('status',status,'reason',reason,'provider_reference',provider_reference) from sc_ext_transactional_email.deliveries d where d.delivery_id=delivery_status.delivery_id;
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."delivery_status"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."delivery_status"(uuid) FROM PUBLIC;

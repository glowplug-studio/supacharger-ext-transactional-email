CREATE OR REPLACE FUNCTION sc_ext_transactional_email.dispatch (
  delivery_ids uuid[] DEFAULT NULL::uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare endpoint text; secret text;
begin
  if not exists(select 1 from sc_ext_transactional_email.settings where enabled) then return; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='sc_ext_transactional_email_worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name='sc_ext_transactional_email_worker_secret';
  if endpoint is null or secret is null or length(secret)<32 then return; end if;
  if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/ext-transactional-email-wakekeeper$' then raise exception 'Invalid worker endpoint'; end if;
  perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    body:=jsonb_build_object('action','process')||case when delivery_ids is null then '{}'::jsonb else jsonb_build_object('ids',delivery_ids) end,timeout_milliseconds:=60000);
exception when others then raise warning 'Email dispatcher unavailable; jobs remain queued';
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."dispatch"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."dispatch"(uuid[]) FROM PUBLIC;

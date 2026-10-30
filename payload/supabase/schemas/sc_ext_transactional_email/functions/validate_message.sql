CREATE OR REPLACE FUNCTION sc_ext_transactional_email.validate_message (
  message jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare recipient jsonb; content jsonb;
begin
  if jsonb_typeof(message) is distinct from 'object' or octet_length(message::text)>100000 or
    message-array['id','to','content','replyTo']<>'{}'::jsonb or
    coalesce(message->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  for recipient in select message->'to' union all select message->'replyTo' where message ? 'replyTo' loop
    if jsonb_typeof(recipient) is distinct from 'object' or recipient-array['email','name']<>'{}'::jsonb or
      jsonb_typeof(recipient->'email') is distinct from 'string' or
      coalesce(recipient->>'email','') !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' or length(recipient->>'email')>254 or
      (recipient ? 'name' and (jsonb_typeof(recipient->'name') is distinct from 'string' or length(recipient->>'name')>200 or recipient->>'name' ~ E'[\r\n]')) then return false; end if;
  end loop;
  content:=message->'content';
  if jsonb_typeof(content) is distinct from 'object' then return false; end if;
  if content->>'kind'='template' then
    return content-array['kind','key','variables']='{}'::jsonb and coalesce(content->>'key','') ~ '^[A-Z][A-Z0-9_]{0,63}$' and jsonb_typeof(content->'variables')='object';
  elsif content->>'kind'='rendered' then
    return content-array['kind','subject','html','text']='{}'::jsonb and jsonb_typeof(content->'subject')='string'
      and length(content->>'subject') between 1 and 998 and content->>'subject' !~ E'[\r\n]'
      and (not content ? 'html' or (jsonb_typeof(content->'html')='string' and length(content->>'html') between 1 and 90000))
      and (not content ? 'text' or (jsonb_typeof(content->'text')='string' and length(content->>'text') between 1 and 90000))
      and (content ? 'html' or content ? 'text');
  end if;
  return false;
end;
$function$;

GRANT EXECUTE ON FUNCTION "sc_ext_transactional_email"."validate_message"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "sc_ext_transactional_email"."validate_message"(jsonb) FROM PUBLIC;

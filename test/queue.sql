begin;
do $$
declare message jsonb:='{"id":"68e522ba-a342-47d1-a260-8571a859a884","to":{"email":"test@example.invalid"},"content":{"kind":"template","key":"TEST","variables":{}}}'; claimed jsonb; token uuid;
begin
  if has_function_privilege('authenticated','api_edge.wakekeeper_ext_tx_enqueue(jsonb)','execute') then raise exception 'Public queue grant'; end if;
  if has_function_privilege('service_role','sc_services.call(text,text,jsonb)','execute') then raise exception 'Public service dispatch'; end if;
  if wakekeeper_ext_transactional_email.validate_message(message-'to') is true then raise exception 'Missing recipient accepted'; end if;
  perform sc_services.call('transactional_email','enqueue',jsonb_build_array(message));
  perform sc_services.call('transactional_email','enqueue',jsonb_build_array(message));
  if (select count(*) from wakekeeper_ext_transactional_email.deliveries)<>1 then raise exception 'Duplicate enqueue'; end if;
  begin perform sc_services.call('transactional_email','enqueue',jsonb_build_array(jsonb_set(message,'{content,variables}','{"changed":true}'))); raise exception 'Changed payload accepted'; exception when invalid_parameter_value then null; end;
  update wakekeeper_ext_transactional_email.settings set enabled=true;
  claimed:=api_edge.wakekeeper_ext_tx_claim(null,'brevo','api');
  if jsonb_array_length(claimed)<>1 then raise exception 'Claim missing'; end if;
  token:=(claimed->0->>'lease_token')::uuid;
  if api_edge.wakekeeper_ext_tx_claim(null,'brevo','api')<>'[]'::jsonb then raise exception 'Double claim'; end if;
  begin perform api_edge.wakekeeper_ext_tx_finish((message->>'id')::uuid,gen_random_uuid(),'{"state":"accepted","reason":"provider_accepted"}'); raise exception 'Stale lease accepted'; exception when invalid_parameter_value then null; end;
  perform api_edge.wakekeeper_ext_tx_finish((message->>'id')::uuid,token,'{"state":"uncertain","reason":"provider_outcome_unknown"}');
  if api_edge.wakekeeper_ext_tx_claim(null,'brevo','api')<>'[]'::jsonb then raise exception 'Uncertain send retried'; end if;
  begin perform api_edge.wakekeeper_ext_tx_retry(array[(message->>'id')::uuid]); raise exception 'Uncertain retry accepted'; exception when invalid_parameter_value then null; end;
end;
$$;
rollback;

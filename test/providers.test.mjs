import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { messageSchema } from '../payload/supabase/shared/contract.ts';
import { createAdapter as brevo } from '../payload/supabase/shared/providers/brevo.ts';
import { createAdapter as resend } from '../payload/supabase/shared/providers/resend.ts';
import { createAdapter as mailgun } from '../payload/supabase/shared/providers/mailgun.ts';
import { createAdapter as smtp } from '../payload/supabase/shared/providers/smtp.ts';
import { createWorker } from '../payload/supabase/shared/worker.ts';
const message={id:'68e522ba-a342-47d1-a260-8571a859a884',to:{email:'test@example.invalid'},content:{kind:'template',key:'TEST',variables:{title:'Test'}}};
const settings={prefix:'test',sender:{email:'sender@example.invalid'},domain:'example.invalid',region:'eu'};
const env=name=>name.endsWith('TEMPLATE_TEST')?'8':name.endsWith('WORKER_SECRET')?'x'.repeat(32):'configured';
test('strict public envelope rejects metadata and invalid bodies',()=>{
 assert.equal(messageSchema.safeParse({...message,metadata:{secret:true}}).success,false);
 assert.equal(messageSchema.safeParse({...message,content:{kind:'rendered',subject:'Hello'}}).success,false);
 assert.equal(messageSchema.safeParse({...message,to:{email:'test@example.invalid',name:'a\nb'}}).success,false);
});
test('Brevo maps only hosted content, authenticates and retains logical identity',async()=>{
 const adapter=brevo(settings,env,async(url,request)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(request.headers['api-key'],'configured');const body=JSON.parse(request.body);assert.equal(body.templateId,8);assert.equal(body.headers.idempotencyKey,message.id);assert.deepEqual(body.params,{title:'Test'});assert.equal(body.metadata,undefined);return Response.json({messageId:'accepted'}, {status:201});});
 assert.equal((await adapter.send(message)).state,'accepted');
 assert.equal((await adapter.preflight({...message,content:{kind:'rendered',subject:'x',text:'x'}})).state,'blocked');
});
test('Brevo inactive template blocks before send',async()=>assert.equal((await brevo(settings,env,async()=>Response.json({isActive:false})).preflight(message)).reason,'template_inactive'));
test('Resend uses bearer and stable idempotency headers',async()=>{
 const result=await resend(settings,env,async(url,request)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(request.headers['Idempotency-Key'],message.id);assert.equal(request.headers.Authorization,'Bearer configured');assert.deepEqual(JSON.parse(request.body).template,{id:'8',variables:{title:'Test'}});return Response.json({id:'accepted'});}).send(message);assert.equal(result.state,'accepted');
});
test('Mailgun uses region, basic auth and multipart fields',async()=>{
 const result=await mailgun(settings,env,async(url,request)=>{assert.equal(url,'https://api.eu.mailgun.net/v3/example.invalid/messages');assert.equal(request.headers.Authorization,'Basic '+btoa('api:configured'));assert.equal(request.body.get('template'),'8');assert.equal(request.body.get('t:variables'),JSON.stringify(message.content.variables));return Response.json({id:'accepted'});}).send(message);assert.equal(result.state,'accepted');
});
test('ambiguous failures never automatically retry; throttling is retryable',async()=>{
 for(const factory of [brevo,resend,mailgun]){
  assert.equal((await factory(settings,env,async()=>{throw Error('timeout');}).send(message)).state,'uncertain');
  assert.equal((await factory(settings,env,async()=>Response.json({}, {status:429,headers:{'retry-after':'120'}})).send(message)).state,'retryable');
 }
});
test('SMTP never accepts provider templates',async()=>assert.equal((await smtp(settings,env).preflight(message)).reason,'unsupported_content'));
test('worker denies unauthenticated commands before opening a database',async()=>{
 let called=false;const worker=createWorker(settings,env,brevo(settings,env),()=>{called=true;throw Error('not allowed');});
 assert.equal((await worker(new Request('https://worker.invalid',{method:'POST',body:'{}'}))).status,401);assert.equal(called,false);
});
test('worker validates authenticated command before database access',async()=>{
 let called=false;const worker=createWorker(settings,env,brevo(settings,env),()=>{called=true;throw Error('not allowed');});
 const response=await worker(new Request('https://worker.invalid',{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(32),'Content-Type':'application/json'},body:JSON.stringify({action:'process',message})}));assert.equal(response.status,400);assert.equal(called,false);
});

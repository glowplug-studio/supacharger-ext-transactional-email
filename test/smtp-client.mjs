import './register.mjs';
const {createAdapter}=await import('../payload/supabase/shared/providers/smtp.ts');
const adapter=createAdapter({prefix:'test',host:'localhost',port:Number(process.argv[2]),tls:'implicit',sender:{email:'sender@example.invalid'}},name=>name.endsWith('SMTP_USER')?'local-user':'local-password');
console.log(JSON.stringify(await adapter.send({id:'68e522ba-a342-47d1-a260-8571a859a884',to:{email:'recipient@example.invalid'},content:{kind:'rendered',subject:'TLS test ü',text:'Hello\n.leading dot'}})));

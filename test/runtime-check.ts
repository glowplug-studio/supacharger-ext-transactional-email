import nodemailer from 'npm:nodemailer@10.3.1';
Deno.serve(async (request: Request) => {
  const secret=Deno.env.get('WAKEKEEPER_EXT_TRANSACTIONAL_EMAIL_WORKER_SECRET');
  if (!secret || request.headers.get('authorization')!==`Bearer ${secret}`) return Response.json({error:'Unauthorised'},{status:401});
  const transport=nodemailer.createTransport({host:'smtp.resend.com',port:465,secure:true,requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:'resend',pass:'invalid-runtime-probe-not-a-secret'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false});
  try { await transport.verify(); return Response.json({tls:true,authentication:'unexpectedly_accepted',sent:false}); }
  catch(error) { const e=error as {code?:string;responseCode?:number};return Response.json({runtime:'supabase-edge',library:'nodemailer@10.3.1',code:e.code,responseCode:e.responseCode,sent:false}); }
  finally {transport.close();}
});

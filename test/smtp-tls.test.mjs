import test from 'node:test';
import assert from 'node:assert/strict';
import {SMTPServer} from 'smtp-server';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,execFile} from 'node:child_process';import {promisify} from 'node:util';
test('SMTP authenticates over verified TLS and constructs MIME without external delivery',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sc-smtp-test-'));let server;let received='';let authenticated=false;
 try{
  const cert=path.join(directory,'cert.pem'),key=path.join(directory,'key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',key,'-out',cert],{stdio:'ignore'});
  server=new SMTPServer({secure:true,key:fs.readFileSync(key),cert:fs.readFileSync(cert),logger:false,
   onAuth(auth,session,callback){authenticated=auth.username==='local-user'&&auth.password==='local-password';callback(authenticated?null:new Error('Rejected'),authenticated?{user:'local-user'}:undefined);},
   onData(stream,session,callback){stream.on('data',chunk=>{received+=chunk.toString();});stream.on('end',()=>callback(null));},
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,resolve);});
  const port=server.server.address().port;
  const {stdout}=await promisify(execFile)(process.execPath,['--import','./test/register.mjs','test/smtp-client.mjs',String(port)],{env:{...process.env,NODE_EXTRA_CA_CERTS:cert},timeout:25000});
  assert.equal(JSON.parse(stdout).state,'accepted');assert.equal(authenticated,true);assert.match(received,/MIME-Version: 1.0/);assert.match(received,/Subject: =\?UTF-8\?/i);assert.match(received,/recipient@example.invalid/);assert.match(received,/\.leading dot/);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});

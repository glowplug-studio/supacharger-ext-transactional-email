import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [rootArg, migrationArg] = process.argv.slice(2);
if (!rootArg || !migrationArg) throw new Error('Usage: node scripts/prepare.mjs <application-root> <CLI-created-migration-filename>');
const root = fs.realpathSync(rootArg);
const require = createRequire(import.meta.url);
const { readServiceConfig } = require(path.join(root, 'src/supacharger/extensions/services.cjs'));
const { readConfig } = require(path.join(root, 'src/supacharger/extensions/prepare.cjs'));
const { namespace, providers } = readServiceConfig(root);
const { namespacePrefix, resourceName } = require(path.join(root, 'src/supacharger/namespace.cjs'));
if (providers.transactional_email !== 'supacharger-ext-transactional-email') throw new Error('Select the transactional email service implementation first');
const configRelative = 'src/app/(project)/(extensions)/(sc_extensions)/(transactional-email)/supacharger-ext-transactional-email.config.ts';
const configFile = path.join(root, configRelative);
const raw = readConfig(fs.existsSync(configFile) ? configFile : path.join(source, 'payload/app/supacharger-ext-transactional-email.config.ts'));
const sender = z.object({ email: z.email().max(254), name: z.string().max(200).regex(/^[^\r\n]*$/).optional() }).strict();
const config = z.discriminatedUnion('provider', [
  z.object({ enabled: z.literal(true), provider: z.literal('brevo'), transport: z.literal('api'), sender: sender.optional() }).strict(),
  z.object({ enabled: z.literal(true), provider: z.literal('resend'), transport: z.literal('api'), sender }).strict(),
  z.object({ enabled: z.literal(true), provider: z.literal('mailgun'), transport: z.literal('api'), sender, domain: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/), region: z.enum(['us','eu']) }).strict(),
  z.object({ enabled: z.literal(true), provider: z.literal('smtp'), transport: z.literal('smtp'), sender, host: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/), port: z.number().int().min(1).max(65535).refine(port => ![25,587].includes(port)), tls: z.enum(['implicit','starttls']) }).strict(),
]).parse(raw);
const migration = path.basename(migrationArg);
if (!/^\d{14}_ext_transactional_email_[a-z0-9_]+\.sql$/.test(migration)) throw new Error('Use a CLI-created ext_transactional_email migration filename');
const output = path.join(source, '.prepared', namespace || 'default');
if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(source, 'payload'), path.join(output, 'payload'), { recursive: true });
const names = { schema: resourceName(namespace, 'ext_transactional_email'), rpcPrefix: 'ext_tx_', worker: resourceName(namespace, 'ext-transactional-email', 'function'), secretPrefix: resourceName(namespace, 'ext_transactional_email', 'secret') + '_' };
const settings = { prefix: namespacePrefix(namespace).slice(0, -1), ...Object.fromEntries(Object.entries(config).filter(([key]) => !['enabled','provider','transport'].includes(key))) };
const workerSource = `import { createClient } from 'npm:@supabase/supabase-js@2.112.3';\nimport { createWorker } from '../_shared/extensions/sc_ext-transactional-email/worker.ts';\nimport { createAdapter } from '../_shared/extensions/sc_ext-transactional-email/providers/${config.provider}.ts';\nconst settings = ${JSON.stringify(settings)} as const;\nconst env = (name: string) => Deno.env.get(name);\nDeno.serve(createWorker(settings, env, createAdapter(settings, env), () => createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } }).schema('${resourceName(namespace, 'api_edge')}')));\n`;
const workerDir = path.join(output, 'payload/supabase/functions', names.worker); fs.mkdirSync(workerDir,{recursive:true}); fs.writeFileSync(path.join(workerDir,'index.ts'),workerSource);
let sql=fs.readFileSync(path.join(source,'templates/queue.sql'),'utf8');
for(const [token,value] of Object.entries({__SCHEMA__:names.schema,__RPC__:names.rpcPrefix,__WORKER__:names.worker,__PROVIDER__:config.provider,__TRANSPORT__:config.transport,__API_EDGE__:resourceName(namespace,'api_edge'),__SERVICES__:resourceName(namespace,'services'),__API__:resourceName(namespace,'api'),__MCP_API__:resourceName(namespace,'mcp_api')})) sql=sql.replaceAll(token,value);
if (/__[A-Z_]+__/.test(sql)) throw new Error('Unresolved SQL template token');
const migrationDirectory = path.join(output,'payload/supabase/migrations');
fs.mkdirSync(migrationDirectory,{recursive:true});
let updateSql = fs.readFileSync(path.join(source,'templates/updates/service-status.sql'),'utf8');
for(const [token,value] of Object.entries({__SCHEMA__:names.schema,__RPC__:names.rpcPrefix,__WORKER__:names.worker,__PROVIDER__:config.provider,__TRANSPORT__:config.transport,__API_EDGE__:resourceName(namespace,'api_edge'),__SERVICES__:resourceName(namespace,'services'),__API__:resourceName(namespace,'api'),__MCP_API__:resourceName(namespace,'mcp_api')})) updateSql=updateSql.replaceAll(token,value);
if (/__[A-Z_]+__/.test(updateSql)) throw new Error('Unresolved SQL update template token');
const installedMigrations = fs.readdirSync(path.join(root,'supabase/migrations'))
  .filter(name => /^\d{14}_ext_transactional_email_[a-z0-9_]+\.sql$/.test(name))
  .filter(name => fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').trim());
if (installedMigrations.length) {
  const definitions = installedMigrations.map(name => fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const originalSchemas = definitions.flatMap(sql => [...sql.matchAll(/create\s+schema\s+(?:if\s+not\s+exists\s+)?"?([a-z][a-z0-9_]*ext_transactional_email)"?\s*;/gi)].map(match => match[1]));
  const history = fs.readdirSync(path.join(root,'supabase/migrations')).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort();
  const resolvedSchemas = new Set(originalSchemas);
  for (const name of history) {
    const body = fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
    for (const match of body.matchAll(/alter\s+schema\s+"?([a-z][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z][a-z0-9_]*)"?\s*;/gi)) {
      if (resolvedSchemas.delete(match[1])) resolvedSchemas.add(match[2]);
    }
  }
  if (!resolvedSchemas.has(names.schema)) throw new Error('Installed SQL history does not match PROJECT_NAMESPACE; complete the reviewed namespace cutover first');
  for (const name of installedMigrations) fs.copyFileSync(path.join(root,'supabase/migrations',name),path.join(migrationDirectory,name));
} else {
  const target=path.join(root,'supabase/migrations',migration);
  if(!fs.existsSync(target) || fs.readFileSync(target,'utf8').trim()) throw new Error('Create an empty migration with the Supabase CLI before preparing a new installation');
  const completeSql=sql+'\n'+updateSql;
  fs.writeFileSync(path.join(migrationDirectory,migration),completeSql);
  fs.writeFileSync(target,completeSql);
}
const kinds = config.provider === 'brevo' ? ['template'] : config.provider === 'smtp' ? ['rendered'] : ['template','rendered'];
fs.writeFileSync(path.join(output,'payload/app/index.ts'), `import 'server-only';\nimport { createTransactionalEmailService } from '@/supacharger/services/transactional-email';\nexport { transactionalMessageSchema } from '@/supacharger/services/transactional-email';\nexport type { TransactionalMessage } from '@/supacharger/services/transactional-email';\nexport const binding = ${JSON.stringify({enqueueRpc:names.rpcPrefix+'enqueue',contentKinds:kinds})} as const;\nexport const createService = (database: Parameters<typeof createTransactionalEmailService>[0]) => createTransactionalEmailService(database,binding);\n`);
const payloadTarget = (id, source) => {
  const mappings = { 'payload/app/': `src/app/(project)/(extensions)/(sc_extensions)/(${id})/`, 'payload/supabase/shared/': `supabase/functions/_shared/extensions/sc_ext-${id}/`, 'payload/supabase/functions/': 'supabase/functions/', 'payload/supabase/migrations/': 'supabase/migrations/', 'payload/docs/': `docs/extensions/${id}/`, 'payload/agents/': `docs/agents/extensions/supacharger-ext-${id}/` };
  for (const [prefix, destination] of Object.entries(mappings)) if (source.startsWith(prefix)) return destination + source.slice(prefix.length);
  throw new Error('Unsupported payload path');
};
const files=[];
function walk(relative){for(const entry of fs.readdirSync(path.join(output,relative),{withFileTypes:true})){const filename=`${relative}/${entry.name}`;if(entry.isDirectory())walk(filename);else{const kind=filename===`payload/app/supacharger-ext-transactional-email.config.ts`?'config':filename.startsWith('payload/supabase/migrations/')?'migration':undefined;files.push({source:filename,target:payloadTarget('transactional-email',filename),...(kind?{kind}:{})});}}}
walk('payload'); files.sort((a,b)=>a.target.localeCompare(b.target));
const manifest={schemaVersion:3,id:'transactional-email',name:'supacharger-ext-transactional-email',version:'0.1.3',coreOwnershipVersion:2,preparedNamespace:namespace,dependencies:[],core_services:[],files};
fs.writeFileSync(path.join(output,'extension.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,names,provider:config.provider,migration}));

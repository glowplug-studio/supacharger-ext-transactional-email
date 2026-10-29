import { z } from 'npm:zod@4.4.3';
import { messageSchema, secretName, type Adapter, type Environment, type Outcome, type Settings } from './contract.ts';
import { readJson } from './http.ts';
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('process'), ids: z.array(z.uuid()).min(1).max(20).optional() }).strict(),
  z.object({ action: z.literal('retry'), ids: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length) }).strict(),
]);
type Database = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export function createWorker(settings: Settings, env: Environment, adapter: Adapter, database: () => Database) {
  const rpcPrefix = `${settings.prefix}_ext_tx_`;
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply({ error: 'Use POST' }, 405);
    const secret = env(secretName(settings, 'WORKER_SECRET'));
    if (!secret || secret.length < 32) return reply({ error: 'Worker is not configured' }, 503);
    const actual = request.headers.get('authorization') ?? '';
    if (actual.length !== secret.length + 7) return reply({ error: 'Unauthorised' }, 401);
    const hashes = await Promise.all([actual, `Bearer ${secret}`].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
    const expected = new Uint8Array(hashes[1]);
    if (new Uint8Array(hashes[0]).reduce((difference, value, index) => difference | (value ^ expected[index]), 0)) return reply({ error: 'Unauthorised' }, 401);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'Use JSON' }, 415);
    let input;
    try { input = commandSchema.parse(await readJson(new Response(request.body))); } catch { return reply({ error: 'Invalid command' }, 400); }
    if (!adapter.ready() || !env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) return reply({ error: 'Delivery is not configured' }, 503);
    try {
      const db = database();
      if (input.action === 'check') {
        const result = await db.rpc(rpcPrefix + 'configuration');
        if (result.error) return reply({ error: 'Database binding unavailable' }, 503);
        const data = result.data as { provider?: string; transport?: string; enabled?: boolean };
        if (data.provider !== adapter.provider || data.transport !== adapter.transport) return reply({ error: 'Deployment selection mismatch' }, 409);
        return reply({ configured: true, provider: adapter.provider, transport: adapter.transport, dispatchEnabled: data.enabled });
      }
      if (input.action === 'retry') {
        const response = await db.rpc(rpcPrefix + 'retry', { delivery_ids: input.ids });
        if (response.error) return reply({ error: 'Select eligible blocked deliveries only' }, 409);
      }
      const response = await db.rpc(rpcPrefix + 'claim', { delivery_ids: input.ids ?? null, expected_provider: adapter.provider, expected_transport: adapter.transport });
      if (response.error || !Array.isArray(response.data) || response.data.length > 20) return reply({ error: 'Could not claim deliveries' }, 503);
      const counts = { accepted: 0, retryable: 0, blocked: 0, uncertain: 0, failed: 0 };
      await Promise.all(response.data.map(async (raw: unknown) => {
        const identity = z.object({ delivery_id: z.uuid(), lease_token: z.uuid(), message: z.unknown() }).safeParse(raw);
        if (!identity.success) { counts.failed++; return; }
        const job = identity.data;
        const parsed = messageSchema.safeParse(job.message);
        let outcome: Outcome;
        try {
          if (!parsed.success || parsed.data.id !== job.delivery_id) outcome = { state: 'blocked', reason: 'invalid_message' };
          else if (!adapter.kinds.includes(parsed.data.content.kind)) outcome = { state: 'blocked', reason: 'unsupported_content' };
          else outcome = await adapter.preflight(parsed.data) ?? await adapter.send(parsed.data);
          const finished = await db.rpc(rpcPrefix + 'finish', { delivery_id: job.delivery_id, lease_token: job.lease_token, outcome });
          if (finished.error) counts.failed++; else counts[outcome.state]++;
        } catch { counts.failed++; }
      }));
      return reply(counts, counts.failed ? 503 : 200);
    } catch { return reply({ error: 'Delivery unavailable' }, 503); }
  };
}

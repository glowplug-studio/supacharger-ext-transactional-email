import { z } from 'npm:zod@4.4.3';
const recipient = z.object({ email: z.email().max(254), name: z.string().max(200).regex(/^[^\r\n]*$/).optional() }).strict();
export const messageSchema = z.object({
  id: z.uuid(), to: recipient,
  content: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('template'), key: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), variables: z.record(z.string(), z.json()) }).strict(),
    z.object({ kind: z.literal('rendered'), subject: z.string().min(1).max(998).regex(/^[^\r\n]*$/), html: z.string().min(1).max(90000).optional(), text: z.string().min(1).max(90000).optional() }).strict().refine(value => !!(value.html || value.text)),
  ]), replyTo: recipient.optional(),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 100000);
export type Message = z.infer<typeof messageSchema>;
export type Outcome = { state: 'accepted' | 'retryable' | 'blocked' | 'uncertain'; reason: string; reference?: string; retryAfter?: number };
export type Adapter = { provider: string; transport: string; kinds: readonly string[]; ready: () => boolean; preflight: (message: Message) => Promise<Outcome | null>; send: (message: Message) => Promise<Outcome> };
export type Environment = (name: string) => string | undefined;
export type Settings = { prefix: string; sender?: { email: string; name?: string }; domain?: string; region?: 'us' | 'eu'; host?: string; port?: number; tls?: 'implicit' | 'starttls' };
export const secretName = (settings: Settings, suffix: string) => `${settings.prefix.toUpperCase()}_EXT_TRANSACTIONAL_EMAIL_${suffix}`;
export const keyFor = (settings: Settings, env: Environment) => env(secretName(settings, 'API_KEY'));
export const templateFor = (settings: Settings, env: Environment, message: Message) => message.content.kind === 'template' ? env(secretName(settings, `TEMPLATE_${message.content.key}`)) : undefined;

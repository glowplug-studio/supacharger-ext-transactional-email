import { keyFor, templateFor, type Adapter, type Environment, type Settings } from '../contract.ts';
import { readJson, rejected } from '../http.ts';
export function createAdapter(settings: Settings, env: Environment, http: typeof fetch = fetch): Adapter {
  const key = () => keyFor(settings, env);
  return {
    provider: 'brevo', transport: 'api', kinds: ['template'], ready: () => !!key(),
    async preflight(message) {
      if (message.content.kind !== 'template') return { state: 'blocked', reason: 'unsupported_content' };
      const id = templateFor(settings, env, message);
      if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return { state: 'blocked', reason: 'template_not_configured' };
      try {
        const response = await http(`https://api.brevo.com/v3/smtp/templates/${id}`, { redirect: 'error', headers: { 'api-key': key()! }, signal: AbortSignal.timeout(10000) });
        if (response.status === 404) return { state: 'blocked', reason: 'template_missing' };
        if (!response.ok) return response.status >= 500 ? { state: 'retryable', reason: 'template_check_unavailable' } : rejected(response);
        const data = await readJson(response);
        return data.isActive === true ? null : { state: 'blocked', reason: 'template_inactive' };
      } catch { return { state: 'retryable', reason: 'template_check_unavailable' }; }
    },
    async send(message) {
      if (message.content.kind !== 'template') return { state: 'blocked', reason: 'unsupported_content' };
      try {
        const response = await http('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'api-key': key()!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: Number(templateFor(settings, env, message)), to: [message.to], params: message.content.variables, headers: { idempotencyKey: message.id }, ...(message.replyTo ? { replyTo: message.replyTo } : {}), ...(settings.sender ? { sender: settings.sender } : {}) }),
        });
        const data = await readJson(response);
        if (response.status === 201 && typeof data.messageId === 'string' && data.messageId.length <= 500) return { state: 'accepted', reason: 'provider_accepted', reference: data.messageId };
        if (response.status === 400 && data.code === 'duplicate_parameter' && typeof data.message === 'string' && /idempotency/i.test(data.message)) return { state: 'accepted', reason: 'provider_duplicate' };
        return response.ok ? { state: 'uncertain', reason: 'invalid_provider_response' } : rejected(response);
      } catch { return { state: 'uncertain', reason: 'provider_outcome_unknown' }; }
    },
  };
}

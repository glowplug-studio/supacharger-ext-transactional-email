import { keyFor, templateFor, type Adapter, type Environment, type Settings } from '../contract.ts';
import { readJson, rejected } from '../http.ts';
export function createAdapter(settings: Settings, env: Environment, http: typeof fetch = fetch): Adapter {
  return {
    provider: 'resend', transport: 'api', kinds: ['template','rendered'], ready: () => !!keyFor(settings, env),
    async preflight(message) {
      if (!settings.sender) return { state: 'blocked', reason: 'sender_not_configured' };
      if (message.content.kind === 'template' && (!templateFor(settings, env, message) || Object.values(message.content.variables).some(value => typeof value !== 'string' && typeof value !== 'number'))) return { state: 'blocked', reason: 'invalid_template_configuration' };
      return null;
    },
    async send(message) {
      const content = message.content;
      try {
        const response = await http('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${keyFor(settings, env)}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.id },
          body: JSON.stringify({ from: settings.sender!.email, to: [message.to.email], ...(message.replyTo ? { reply_to: message.replyTo.email } : {}), ...(content.kind === 'template' ? { template: { id: templateFor(settings, env, message), variables: content.variables } } : { subject: content.subject, html: content.html, text: content.text }) }),
        });
        const data = await readJson(response);
        if (response.ok && typeof data.id === 'string' && data.id.length <= 500) return { state: 'accepted', reason: 'provider_accepted', reference: data.id };
        return response.ok ? { state: 'uncertain', reason: 'invalid_provider_response' } : rejected(response);
      } catch { return { state: 'uncertain', reason: 'provider_outcome_unknown' }; }
    },
  };
}

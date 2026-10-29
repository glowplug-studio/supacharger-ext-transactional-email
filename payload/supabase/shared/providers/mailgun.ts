import { keyFor, templateFor, secretName, type Adapter, type Environment, type Settings } from '../contract.ts';
import { readJson, rejected } from '../http.ts';
export function createAdapter(settings: Settings, env: Environment, http: typeof fetch = fetch): Adapter {
  return {
    provider: 'mailgun', transport: 'api', kinds: ['template','rendered'], ready: () => !!keyFor(settings, env) && !!settings.domain && !!settings.sender,
    async preflight(message) {
      return message.content.kind === 'template' && !templateFor(settings, env, message) ? { state: 'blocked', reason: 'template_not_configured' } : null;
    },
    async send(message) {
      const body = new FormData(); body.set('from', settings.sender!.email); body.set('to', message.to.email);
      if (message.replyTo) body.set('h:Reply-To', message.replyTo.email);
      if (message.content.kind === 'template') { body.set('template', templateFor(settings, env, message)!); body.set('t:variables', JSON.stringify(message.content.variables)); const version=env(secretName(settings, `TEMPLATE_VERSION_${message.content.key}`)); if(version) body.set('t:version', version); }
      else { body.set('subject', message.content.subject); if (message.content.html) body.set('html', message.content.html); if (message.content.text) body.set('text', message.content.text); }
      try {
        const response = await http(`https://api${settings.region === 'eu' ? '.eu' : ''}.mailgun.net/v3/${encodeURIComponent(settings.domain!)}/messages`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${btoa(`api:${keyFor(settings, env)}`)}` }, body,
        });
        const data = await readJson(response);
        if (response.ok && typeof data.id === 'string' && data.id.length <= 500) return { state: 'accepted', reason: 'provider_accepted', reference: data.id };
        return response.ok ? { state: 'uncertain', reason: 'invalid_provider_response' } : rejected(response);
      } catch { return { state: 'uncertain', reason: 'provider_outcome_unknown' }; }
    },
  };
}

import nodemailer from 'npm:nodemailer@10.3.1';
import { secretName, type Adapter, type Environment, type Settings } from '../contract.ts';
export function createAdapter(settings: Settings, env: Environment): Adapter {
  const ready = () => !!settings.host && !!settings.sender && !!env(secretName(settings, 'SMTP_USER')) && !!env(secretName(settings, 'SMTP_PASSWORD'));
  const client = () => nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.tls === 'implicit', requireTLS: true,
    auth: { user: env(secretName(settings, 'SMTP_USER')), pass: env(secretName(settings, 'SMTP_PASSWORD')) },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  return {
    provider: 'smtp', transport: 'smtp', kinds: ['rendered'], ready,
    async preflight(message) { return message.content.kind !== 'rendered' ? { state: 'blocked', reason: 'unsupported_content' } : null; },
    async send(message) {
      if (message.content.kind !== 'rendered') return { state: 'blocked', reason: 'unsupported_content' };
      const transport = client();
      try {
        const result = await transport.sendMail({ from: { address: settings.sender!.email, name: settings.sender!.name }, to: [{ address: message.to.email, name: message.to.name }], replyTo: message.replyTo ? { address: message.replyTo.email, name: message.replyTo.name } : undefined, subject: message.content.subject, html: message.content.html, text: message.content.text, messageId: `<${message.id}@${settings.sender!.email.split('@')[1]}>` });
        return result.accepted.length === 1 ? { state: 'accepted', reason: 'provider_accepted', reference: result.messageId } : { state: 'blocked', reason: 'recipient_rejected' };
      } catch (error) {
        const code = (error as { code?: string }).code;
        return code === 'EAUTH' || code === 'EENVELOPE' ? { state: 'blocked', reason: 'smtp_rejected' } : { state: 'uncertain', reason: 'provider_outcome_unknown' };
      } finally { transport.close(); }
    },
  };
}

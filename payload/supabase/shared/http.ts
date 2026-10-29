import type { Outcome } from './contract.ts';
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 65536) { await reader.cancel(); throw new Error('Response too large'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response');
  return value;
}
export function rejected(response: Response): Outcome {
  if (response.status === 429) {
    const raw = response.headers.get('retry-after') ?? '';
    const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
    return { state: 'retryable', reason: 'rate_limited', retryAfter: Math.min(86400, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) };
  }
  if (response.status >= 500 || response.status === 408) return { state: 'uncertain', reason: 'provider_outcome_unknown' };
  return { state: 'blocked', reason: response.status === 401 || response.status === 403 ? 'credentials_rejected' : 'provider_rejected' };
}

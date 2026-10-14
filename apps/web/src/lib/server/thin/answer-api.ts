// POST /api/answer (thin mode): body { fields, context } → { answers, order }.
// BYOK: x-llm-key (+ optional x-llm-provider) is used for this request only: never logged, stored or cached.
// Without x-llm-key the server uses its own key from env (or the account chain for the owner).
import type { Provider } from '../../../../../hh/src/model/model.ts';
import type { FieldOut, Llm } from './answer-engine.ts';

import { answerFields, ORDER, parseContext, parseFields } from './answer-engine.ts';
import { presetOf } from '../../../../../hh/src/model/model.ts';

export type Complete = (provider: Provider, prompt: string) => Promise<string>;
export type AskChain = (chain: Provider[], prompt: string) => Promise<string>;

export function isThinBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && Array.isArray((body as { fields?: unknown }).fields);
}

// BYOK provider from headers; key stays in this object (request scope) only.
export function byokProvider(headers: Headers, fallbackId = 'groq'): Provider | null {
  const key = (headers.get('x-llm-key') ?? '').trim();
  if (!key)
    return null;

  const preset = presetOf((headers.get('x-llm-provider') ?? '').trim() || fallbackId) ?? presetOf('groq');
  if (!preset || preset.id === 'custom')
    return null;

  return { id: preset.id, key, model: preset.model, url: preset.url };
}

export function pickLlm(headers: Headers, ourChain: Provider[], deps: { complete: Complete; askChain: AskChain }): { llm: Llm | null; mode: 'byok' | 'ours' | 'none' } {
  const own = byokProvider(headers, ourChain[0]?.id);
  if (own)
    return { llm: prompt => deps.complete(own, prompt), mode: 'byok' };

  if (ourChain.length > 0)
    return { llm: prompt => deps.askChain(ourChain, prompt), mode: 'ours' };

  return { llm: null, mode: 'none' };
}

export async function thinAnswer(headers: Headers, body: unknown, ourChain: Provider[], deps: { complete: Complete; askChain: AskChain }): Promise<{ answers: FieldOut[]; order: readonly string[]; llm: 'byok' | 'ours' | 'none' }> {
  const row = body as { fields?: unknown; context?: unknown };
  const { llm, mode } = pickLlm(headers, ourChain, deps);
  const answers = await answerFields(parseFields(row.fields), parseContext(row.context), llm);

  return { answers, order: ORDER, llm: mode };
}
export { completion } from '../../../../../hh/src/model/model.ts';

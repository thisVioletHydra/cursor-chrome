import type { Model, Verdict } from './rules.ts';

import { modelPrompt } from './judge.ts';
import { PING_MS } from './limits.ts';

import process from 'node:process';

const URL = 'https://api.mistral.ai/v1/chat/completions';

export function mistralFromEnv(): Model | null {
  const key = process.env.MISTRAL_API_KEY ?? '';
  if (key.length === 0)
    return null;

  return vacancy => askMistral(key, modelPrompt(vacancy));
}

export async function askMistral(key: string, prompt: string): Promise<{ verdict: Verdict; reason: string }> {
  return parseVerdict(await mistralText(key, prompt));
}

export async function mistralText(key: string, prompt: string, timeoutMs = PING_MS): Promise<string> {
  const res = await fetch(URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL ?? 'mistral-small-latest',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (res.ok === false)
    throw new Error(`mistral ${res.status}`);

  const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };

  return body.choices?.[0]?.message?.content ?? '';
}

export function parseVerdict(raw: string): { verdict: Verdict; reason: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return { verdict: 'human', reason: 'модель не ответила' };

  const parsed = JSON.parse(match[0]) as { verdict?: string; reason?: string };
  const verdict = parsed.verdict === 'apply' || parsed.verdict === 'skip' ? parsed.verdict : 'human';
  const reason = typeof parsed.reason === 'string' && parsed.reason.length > 0
    ? parsed.reason
    : 'без причины';

  return { verdict, reason };
}

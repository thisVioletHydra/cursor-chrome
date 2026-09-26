import type { Model, Verdict } from './rules.ts';

import { modelPrompt } from './judge.ts';
import { PING_MS } from './limits.ts';

import process from 'node:process';

export type ProviderId = 'groq' | 'gemini' | 'zai' | 'openrouter' | 'deepseek' | 'mistral' | 'custom';

export type Provider = {
  id: ProviderId;
  key: string;
  model: string;
  url: string;
};

export type Preset = {
  id: ProviderId;
  name: string;
  url: string;
  model: string;
  keysUrl: string;
  free: boolean;
};

export const PRESETS: Preset[] = [
  { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', keysUrl: 'https://console.groq.com/keys', free: true },
  { id: 'gemini', name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', keysUrl: 'https://aistudio.google.com/apikey', free: true },
  { id: 'zai', name: 'Z.ai', url: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-4.5-flash', keysUrl: 'https://z.ai/manage-apikey/apikey-list', free: true },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek/deepseek-chat-v3-0324:free', keysUrl: 'https://openrouter.ai/settings/keys', free: true },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', keysUrl: 'https://platform.deepseek.com/api_keys', free: false },
  { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', keysUrl: 'https://console.mistral.ai/api-keys', free: false },
  { id: 'custom', name: 'Свой', url: '', model: '', keysUrl: '', free: false },
];

const REST_MS = 60_000;
const MAX_CHAIN = 8;
const resting = new Map<string, number>();

export function presetOf(id: string): Preset | null {
  return PRESETS.find(item => item.id === id) ?? null;
}

export function providerName(provider: Provider): string {
  const preset = presetOf(provider.id);
  if (provider.id === 'custom' || preset === null)
    return hostOf(provider.url) || 'свой';

  return preset.name;
}

export function parseChain(raw: string): Provider[] {
  if (raw.trim().length === 0)
    return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return [];
  }
  if (Array.isArray(parsed) === false)
    return [];

  return parsed.flatMap(item => (asProvider(item) ? [asProvider(item) as Provider] : [])).slice(0, MAX_CHAIN);
}

export function asProvider(value: unknown): Provider | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Record<string, unknown>;
  const preset = typeof row.id === 'string' ? presetOf(row.id) : null;
  if (preset === null || typeof row.key !== 'string' || row.key.trim().length === 0)
    return null;

  const model = typeof row.model === 'string' && row.model.trim().length > 0 ? row.model.trim() : preset.model;
  const url = typeof row.url === 'string' && row.url.trim().length > 0 ? row.url.trim() : preset.url;
  if (model.length === 0 || /^https:\/\//.test(url) === false)
    return null;

  return { id: preset.id, key: row.key.trim(), model, url };
}

export function chainFromEnv(): Provider[] {
  const chain = parseChain(process.env.MODEL_CHAIN ?? '');
  if (chain.length > 0)
    return chain;

  const mistral = process.env.MISTRAL_API_KEY ?? '';

  return mistral.length > 0 ? [asProvider({ id: 'mistral', key: mistral, model: process.env.MISTRAL_MODEL }) as Provider] : [];
}

export function modelFromEnv(): Model | null {
  const chain = chainFromEnv();
  if (chain.length === 0)
    return null;

  return async vacancy => parseVerdict((await askChain(chain, modelPrompt(vacancy))).text);
}

export async function completion(provider: Provider, prompt: string, opts: { timeoutMs?: number; maxTokens?: number } = {}): Promise<string> {
  const res = await fetch(provider.url, {
    method: 'POST',
    signal: AbortSignal.timeout(opts.timeoutMs ?? PING_MS),
    headers: {
      authorization: `Bearer ${provider.key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (res.ok === false)
    throw new Error(`${providerName(provider)} ${res.status}`);

  const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };

  return body.choices?.[0]?.message?.content ?? '';
}

export async function askChain(chain: Provider[], prompt: string, timeoutMs = PING_MS): Promise<{ text: string; provider: Provider }> {
  if (chain.length === 0)
    throw new Error('нет ключа модели');

  const reasons: string[] = [];
  for (const provider of chain) {
    if (isResting(provider))
      continue;

    try {
      const text = await completion(provider, prompt, { timeoutMs });

      return { text, provider };
    }
    catch (error) {
      rest(provider);
      const name = providerName(provider);
      const message = error instanceof Error ? error.message : 'упал';
      reasons.push(message.startsWith(name) ? message : `${name}: ${message}`);
    }
  }

  throw new Error(reasons.length > 0 ? reasons.join(', ') : 'все провайдеры отдыхают');
}

export async function probeProvider(provider: Provider, timeoutMs = PING_MS): Promise<{ ok: boolean; detail: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${provider.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      }),
    });
  }
  catch {
    return { ok: false, detail: `${providerName(provider)} не ответил`, status: 0 };
  }

  const name = providerName(provider);
  if (res.status === 401 || res.status === 403)
    return { ok: false, detail: `${name}: ключ не принят`, status: res.status };

  if (res.status === 404)
    return { ok: false, detail: `${name}: модель ${provider.model} не найдена`, status: res.status };

  if (res.status === 429)
    return { ok: false, detail: `${name}: лимит или нет плана`, status: res.status };

  if (res.ok === false)
    return { ok: false, detail: `${name} ${res.status}`, status: res.status };

  return { ok: true, detail: `${name} · ${provider.model}`, status: res.status };
}

export async function pingChain(chain: Provider[]): Promise<string[]> {
  if (chain.length === 0)
    return ['нет ключа модели'];

  const probes = await Promise.all(chain.map(provider => probeProvider(provider)));
  if (probes.some(probe => probe.ok))
    return [];

  return probes.map(probe => probe.detail);
}

export function parseVerdict(raw: string): { verdict: Verdict; reason: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return { verdict: 'human', reason: 'модель не ответила' };

  let parsed: { verdict?: string; reason?: string };
  try {
    parsed = JSON.parse(match[0]) as typeof parsed;
  }
  catch {
    return { verdict: 'human', reason: 'модель не ответила' };
  }
  const verdict = parsed.verdict === 'apply' || parsed.verdict === 'skip' ? parsed.verdict : 'human';
  const reason = typeof parsed.reason === 'string' && parsed.reason.length > 0
    ? parsed.reason
    : 'без причины';

  return { verdict, reason };
}

function restKey(provider: Provider): string {
  return `${provider.url}|${provider.model}|${provider.key.slice(-6)}`;
}

function isResting(provider: Provider): boolean {
  return (resting.get(restKey(provider)) ?? 0) > Date.now();
}

function rest(provider: Provider): void {
  resting.set(restKey(provider), Date.now() + REST_MS);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  }
  catch {
    return '';
  }
}

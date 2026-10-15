// Transit context for the server planner (POST /api/ext/next {context}): profile, letter, canon («Правила»),
// memory («Память»), facts. Built from LocalData on every chain start, cut to the server limits here
// (an over-limit body makes the server stop with needsHuman), and passed through stripSecrets.
// LLM keys never travel in this body: they stay in their own headers.
import type { LocalData } from '../local/schema.ts';

import { SECRET_NAME, stripSecrets } from '../local/schema.ts';

export const TRANSIT_LIMITS = { bodyBytes: 65_536, profileBytes: 32_768, letter: 10_000, canon: 300, canonText: 2_000, aliases: 20, alias: 500, memory: 500, prompt: 500, answer: 2_000, facts: 200, fact: 500 } as const;

export type TransitContext = {
  profile: Record<string, unknown> | null;
  letter: string;
  canon: Array<{ title: string; aliases: string[]; answer: string }>;
  memory: Array<{ prompt: string; answer: string; human?: boolean }>;
  facts: string[];
};

const L = TRANSIT_LIMITS;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const cut = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max);
// a value that itself looks like a key (sk-…, gsk_…, AIza…, Bearer …) is never sent, whatever field it sits in
const KEY_VALUE = /\b(sk-[\w-]{16,}|gsk_[\w-]{16,}|AIza[\w-]{20,}|xai-[\w-]{16,}|Bearer\s+[\w.-]{16,})/;
const clean = (text: string) => (KEY_VALUE.test(text) || SECRET_NAME.test(text) && /[:=]\s*\S{16,}/.test(text) ? '' : text);

function factLines(facts: LocalData['facts'] | undefined): string[] {
  const lines = [
    ...(facts?.rules ?? []),
    ...String(facts?.notes ?? '').split('\n'),
    ...String(facts?.resume ?? '').split('\n'),
  ];

  return lines.map(line => clean(cut(line.trim(), L.fact))).filter(line => line.length > 0).slice(0, L.facts);
}

function canonOf(data: LocalData | null): TransitContext['canon'] {
  const seen = new Set<string>();
  const out: TransitContext['canon'] = [];
  for (const row of [...(data?.rules ?? []), ...(data?.canonSeed?.items ?? [])]) {
    const title = clean(cut(row.title.trim(), L.canonText));
    const answer = clean(cut(row.answer, L.canonText));
    const id = title.toLowerCase();
    if (title === '' || answer.trim() === '' || seen.has(id))
      continue;

    seen.add(id);
    const aliases = (row.aliases ?? []).map(alias => clean(cut(alias, L.alias))).filter(alias => alias.length > 0).slice(0, L.aliases);
    out.push({ title, aliases, answer });
    if (out.length >= L.canon)
      break;
  }

  return out;
}

function memoryOf(data: LocalData | null): TransitContext['memory'] {
  // human-typed answers first: they are the ones that survive a size cut
  const rows = [...(data?.memory ?? [])].sort((a, b) => Number(b.human === true) - Number(a.human === true));

  return rows
    .map(row => ({ prompt: clean(cut(row.prompt, L.prompt)), answer: clean(cut(row.answer, L.answer)), ...(row.human === true ? { human: true } : {}) }))
    .filter(row => row.prompt.trim() !== '' && row.answer.trim() !== '')
    .slice(0, L.memory);
}

function profileOf(data: LocalData | null): Record<string, unknown> | null {
  const profile = data?.profile ? stripSecrets(data.profile as unknown as Record<string, unknown>) : null;

  return profile !== null && bytes(profile) <= L.profileBytes ? profile : null;
}

// Whole body ≤ 64 KB: drop the tail of memory, then canon, then facts, then the profile.
export function buildTransit(data: LocalData | null, letterText: string): { context: TransitContext; trimmed: string[] } {
  const context: TransitContext = stripSecrets({
    profile: profileOf(data),
    letter: clean(cut(letterText, L.letter)),
    canon: canonOf(data),
    memory: memoryOf(data),
    facts: factLines(data?.facts),
  });
  const trimmed: string[] = [];
  if (data?.profile && context.profile === null)
    trimmed.push('profile > 32 КБ');

  const fits = () => bytes({ context }) <= L.bodyBytes;
  for (const field of ['memory', 'canon', 'facts'] as const) {
    let dropped = 0;
    while (fits() === false && context[field].length > 0) {
      context[field].length = Math.max(0, context[field].length - Math.max(1, Math.ceil(context[field].length / 20)));
      dropped += 1;
    }

    if (dropped > 0)
      trimmed.push(`${field} урезан до ${context[field].length}`);
  }

  if (fits() === false) {
    context.profile = null;
    trimmed.push('profile убран: тело > 64 КБ');
  }

  if (fits() === false) {
    context.letter = context.letter.slice(0, 2_000);
    trimmed.push('letter урезан');
  }

  return { context, trimmed };
}

export function transitBody(context: TransitContext): string {
  return JSON.stringify({ context });
}

// x-ext-tab: [\w:.-], ≤ 100 chars, stable per worker tab
export function tabHeader(raw: string): string {
  return raw.replace(/[^\w:.-]/g, '').slice(0, 100);
}

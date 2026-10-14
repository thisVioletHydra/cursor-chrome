// Thin client for form answers: collects the user's context (profile, letter, facts and memory candidates found
// locally by the index) and asks the server, which applies the rule order, type check and threshold.
// No decision logic here: the extension reads the form, shows and fills the answer. Never submits.
import type { LocalData } from './schema.ts';
import type { VacancyFacts } from '../../../hh/src/review/profile.ts';

import { questionKey } from '../../../hh/src/review/form.ts';
import { LEXICAL_MIN, lexicalScore } from '../../../hh/src/review/normalize.ts';

export const THIN_ANSWER = 'thin-answer';
export const MAX_CANDIDATES = 12;

export type ThinField = { id?: string; prompt: string; kind: 'text' | 'number' | 'choice'; options: string[] };
export type ThinReply = { id: string; answer?: string; source?: string; from?: string; score?: number; human?: true; reason?: string };

const close = (prompt: string, text: string) => (questionKey(text) === questionKey(prompt) ? 1 : lexicalScore(prompt, text));

// Index lookup stays local (cheap, no server round trip for the whole memory): only near candidates go out.
export function contextFor(fields: ThinField[], data: LocalData | null, vacancy: VacancyFacts = {}, formText = ''): Record<string, unknown> {
  if (data === null)
    return { vacancy, formText };

  const near = <T>(items: T[], texts: (item: T) => string[]) => items
    .map(item => ({ item, score: Math.max(0, ...fields.flatMap(field => texts(item).map(text => close(field.prompt, text)))) }))
    .filter(row => row.score >= LEXICAL_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(row => row.item);

  return {
    profile: data.profile,
    coverLetter: data.coverLetter,
    facts: data.facts.rules,
    rules: near(data.rules, rule => [rule.title, ...rule.aliases]).map(rule => ({ title: rule.title, aliases: rule.aliases, answer: rule.answer })),
    memory: near(data.memory, row => [row.prompt]).map(row => ({ prompt: row.prompt, answer: row.answer, human: row.human === true })),
    vacancy,
    formText,
  };
}

export async function askServer(
  base: string,
  key: string,
  fields: ThinField[],
  context: Record<string, unknown>,
  extra: { llmKey?: string; llmProvider?: string; version?: string } = {},
  fetcher: typeof fetch = fetch,
): Promise<ThinReply[]> {
  const human = (reason: string) => fields.map((field, index) => ({ id: field.id ?? String(index), human: true as const, reason }));
  if (!base || !key)
    return human('админка не подключена');

  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  if (extra.llmKey)
    headers['x-llm-key'] = extra.llmKey;
  if (extra.llmProvider)
    headers['x-llm-provider'] = extra.llmProvider;
  if (extra.version)
    headers['x-ext-version'] = extra.version;
  try {
    const res = await fetcher(`${base}/api/answer`, { method: 'POST', headers, body: JSON.stringify({ fields: fields.map((field, index) => ({ ...field, id: field.id ?? String(index) })), context }) });
    if (res.status === 426)
      return human('расширение устарело: обнови его по ссылке в плашке');
    if (res.ok === false)
      return human(`админка ${res.status}`);

    const body = await res.json() as { answers?: ThinReply[] };

    return Array.isArray(body.answers) ? body.answers : human('сервер не ответил');
  }
  catch {
    return human('админка не ответила');
  }
}

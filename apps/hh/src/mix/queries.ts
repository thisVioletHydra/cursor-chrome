import type { Provider } from '../model/model.ts';

import { FACTS } from '../model/copy.ts';
import { askChain } from '../model/model.ts';

const DEFAULT_QUERIES = [
  'Frontend',
  'Frontend AI',
  'Vue.js',
  'vue',
  'TypeScript',
  'JavaScript',
  'React',
  'Node.js',
  'Fullstack',
  'NestJS',
  'GraphQL',
];

export const DEFAULT_QUERY = DEFAULT_QUERIES.join('\n');

const FRONT_AI = 'Frontend AI';

export function withFrontAi(queries: readonly string[]): string[] {
  if (queries.some(frontAiQuery))
    return [...queries];

  const at = queries.findIndex(query => /^frontend$/i.test(query.trim()));
  if (at < 0)
    return [FRONT_AI, ...queries];

  return [...queries.slice(0, at + 1), FRONT_AI, ...queries.slice(at + 1)];
}

const MAX_QUERIES = 5;
const SUGGEST_TRY_MS = 9_000;
const SUGGEST_MS = 28_000;

export async function suggestQueries(chain: Provider[], letter: string): Promise<{ queries: string[]; provider: Provider }> {
  const { text, provider } = await askChain(chain, queriesPrompt(letter), SUGGEST_TRY_MS, SUGGEST_MS);
  const queries = parseQueries(text);
  if (queries.length === 0)
    throw new Error(`ответ без списка: ${text.slice(0, 80)}`);

  return { queries, provider };
}

export function queriesPrompt(letter: string): string {
  return [
    'Составь поисковые запросы для hh.ru под этого кандидата.',
    'От 3 до 5 запросов, каждый 2–3 слова: роль плюс технология, как ищут работодатели.',
    'Только то, что есть в фактах. Не выдумывай Python, Kubernetes, английский C1.',
    'Факты:',
    FACTS,
    letter.length > 0 ? `Сопроводительное:\n${letter.slice(0, 1500)}` : '',
    'Ответ одной строкой JSON: {"queries":["...","..."]}',
  ].filter(part => part.length > 0).join('\n');
}

export function parseQueries(raw: string): string[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return [];

  let parsed: { queries?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { queries?: unknown };
  }
  catch {
    return [];
  }
  if (Array.isArray(parsed.queries) === false)
    return [];

  const clean = parsed.queries
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length > 0 && item.length <= 60);

  return [...new Set(clean)].slice(0, MAX_QUERIES);
}

export function splitQueries(text: string): string[] {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  return [...new Set(lines)];
}

function frontAiQuery(query: string): boolean {
  const front = /frontend|front[\s-]*end|фронтенд|фронтэнд/i.test(query);
  const ai = /(?:^|[^\p{L}\p{N}])ai(?=$|[^\p{L}\p{N}])/iu.test(query);

  return front && ai;
}

import type { Provider } from './model.ts';

import { FACTS } from './copy.ts';
import { askChain } from './model.ts';

const ATS_TRY_MS = 9_000;
const ATS_MS = 28_000;
const MAX_FLAGS = 5;

export function atsSource(letter: string): string {
  const cover = letter.replace(/\r\n/g, '\n').trim().slice(0, 4000);

  return [FACTS, cover].filter(part => part.length > 0).join('\n\n');
}

export async function scoreAts(chain: Provider[], letter: string): Promise<{ score: number; flags: string[]; provider: Provider }> {
  const { text, provider } = await askChain(chain, atsPrompt(letter), ATS_TRY_MS, ATS_MS);
  const parsed = parseAts(text);
  if (parsed === null)
    throw new Error(`ответ без оценки: ${text.slice(0, 80)}`);

  return { ...parsed, provider };
}

function atsPrompt(letter: string): string {
  return [
    'Ты ATS-робот. Оцени текст: насколько он проходит автоматический фильтр резюме.',
    '100 — робот вытащит роль и стек. 0 — мусор, робот отсеет.',
    'Красные флаги: до 5 коротких фраз по-русски. Только то, что видно в тексте. Навыки не выдумывай.',
    'Если флагов нет, flags пустой.',
    'Текст:',
    atsSource(letter),
    'Ответ только JSON: {"score":72,"flags":["..."]}',
  ].join('\n');
}

function parseAts(raw: string): { score: number; flags: string[] } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  }
  catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null)
    return null;

  const row = parsed as { score?: unknown; flags?: unknown };
  const score = scoreOf(row.score);
  if (score === null || Array.isArray(row.flags) === false)
    return null;

  const flags = row.flags
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length > 0 && item.length <= 180)
    .slice(0, MAX_FLAGS);

  return { score, flags };
}

function scoreOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (Number.isInteger(n) === false || n < 0 || n > 100)
    return null;

  return n;
}

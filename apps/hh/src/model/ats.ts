import type { Provider } from './model.ts';

import { askChain } from './model.ts';

const ATS_TRY_MS = 46_000;
const ATS_MS = 52_000;
const ATS_TOKENS = 3_072;
const MIN_FLAGS = 6;
const MAX_FLAGS = 12;
const SOURCE_MAX = 24_000;
const RISK_MAX = 96;
const THINK_MAX = 220;

const BASE_RANK: Record<string, number> = {
  groq: 90,
  deepseek: 80,
  cohere: 70,
  gemini: 60,
  custom: 50,
  mistral: 30,
  zai: 25,
  openrouter: 20,
};

const LEVEL_ORDER = { red: 0, orange: 1, yellow: 2 } as const;

export type AtsLevel = keyof typeof LEVEL_ORDER;

export type AtsFlag = {
  level: AtsLevel;
  risk: string;
  think: string;
};

export function atsSource(resume: string): string {
  return resume.replace(/\r\n/g, '\n').trim().slice(0, SOURCE_MAX);
}

export function atsRank(provider: { id: string; model: string }): number {
  const model = provider.model.toLowerCase();
  let rank = BASE_RANK[provider.id] ?? 10;
  const size = /(\d+(?:\.\d+)?)b\b/.exec(model);
  if (size !== null)
    rank += Math.min(Number(size[1]), 160) / 2;
  if (model.includes('gpt-oss'))
    rank += 25;
  if (model.includes('plus') || model.includes('reasoner') || model.includes('large'))
    rank += 15;
  if (/(small|mini|nano|lite)/.test(model))
    rank -= 35;
  if (model.includes('flash') && model.includes('gpt-oss') === false)
    rank -= 8;

  return rank;
}

function atsOrder<T extends { id: string; model: string }>(chain: readonly T[]): T[] {
  return chain
    .map((item, index) => ({ item, index }))
    .sort((a, b) => atsRank(b.item) - atsRank(a.item) || a.index - b.index)
    .map(row => row.item);
}

export function atsFirst<T extends { id: string; model: string }>(chain: readonly T[]): T | null {
  return atsOrder(chain)[0] ?? null;
}

export async function scoreAts(chain: Provider[], resume: string): Promise<{ score: number; flags: AtsFlag[]; provider: Provider }> {
  const source = atsSource(resume);
  if (source.length === 0)
    throw new Error('текста резюме ещё нет');

  const lead = atsFirst(chain);
  if (lead === null)
    throw new Error('нет ключа модели');

  const { text, provider } = await askChain([lead], atsPrompt(source), ATS_TRY_MS, ATS_MS, ATS_TOKENS);
  const parsed = parseAts(text);
  if (parsed === null)
    throw new Error(`ответ без разбора: ${text.slice(0, 80)}`);

  return { ...parsed, provider };
}

function atsPrompt(resume: string): string {
  return [
    'Ты рекрутер. За 20 секунд решаешь, отложить резюме или читать дальше. Рядом ATS, он цепляется за то же самое.',
    'Разбери этот текст. Не хвали. Не давай советов кандидату.',
    'Запрещены общие фразы: «добавьте ключевые слова», «оформите лучше», «укажите достижения», «раскройте опыт».',
    'Каждый флаг — риск, который прямо виден в тексте, и одна фраза: что подумает рекрутер или робот. Вопрос, сомнение или ярлык. Не рекомендация.',
    'Только то, что написано. Навыки, компании, цифры и роли не выдумывай. Нет в тексте — нет флага.',
    'Смотри на противоречия и мусор, и только если они есть: стек шире, чем подтверждает работа; легаси занимает место, а текущий стек не виден; в шапке две роли сразу; абзац про AI вместо кода; технологии без места, где они применялись; нет цифр и результата; навыки повторяются; посторонние блоки и кривое оформление.',
    'Флагов от 6 до 12. Один риск — один флаг.',
    'level: red — из-за этого отложат; orange — сильное сомнение; yellow — режет глаз, само по себе не отказ.',
    'risk — короткий заголовок, до 8 слов. think — одно предложение.',
    'score — целое от 0 до 100. Много red про роль, стек и отсутствие результата: ниже 45. Узкая роль, стек подтверждён работой, есть цифры: выше 70.',
    'Резюме:',
    resume,
    'Только JSON этой формы, свои формулировки, без markdown: {"score":0,"flags":[{"level":"red","risk":"...","think":"..."}]}',
  ].join('\n');
}

function parseAts(raw: string): { score: number; flags: AtsFlag[] } | null {
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

  const score = scoreOf(own(parsed, 'score'));
  const flags = asAtsFlags(own(parsed, 'flags'));
  if (score === null || flags.length < MIN_FLAGS)
    return null;

  return { score, flags };
}

export function asAtsFlags(value: unknown): AtsFlag[] {
  if (Array.isArray(value) === false)
    return [];

  const seen = new Set<string>();
  const flags: AtsFlag[] = [];
  for (const item of value) {
    const flag = flagOf(item);
    if (flag === null)
      continue;

    const key = flag.risk.toLowerCase();
    if (seen.has(key))
      continue;

    seen.add(key);
    flags.push(flag);
  }

  flags.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return flags.slice(0, MAX_FLAGS);
}

function flagOf(value: unknown): AtsFlag | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const level = asLevel(own(value, 'level'));
  const risk = cleanLine(own(value, 'risk'), RISK_MAX);
  const think = cleanLine(own(value, 'think'), THINK_MAX);
  if (level === null || risk === null || think === null)
    return null;

  return { level, risk, think };
}

function asLevel(value: unknown): AtsLevel | null {
  if (typeof value !== 'string')
    return null;

  const level = value.trim().toLowerCase();
  if (level === 'red' || level === 'orange' || level === 'yellow')
    return level;

  return null;
}

function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string')
    return null;

  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length === 0 || text.length > max)
    return null;

  return text;
}

function scoreOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (Number.isFinite(n) === false)
    return null;

  const score = Math.round(n);
  if (score < 0 || score > 100)
    return null;

  return score;
}

function own(value: object, key: string): unknown {
  if (Object.hasOwn(value, key) === false)
    return undefined;

  return Reflect.get(value, key);
}

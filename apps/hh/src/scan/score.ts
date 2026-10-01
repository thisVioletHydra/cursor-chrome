import type { Vacancy } from './rules.ts';

import { roleJunk } from '../mix/mix.ts';
import { hardSkip, NO_META, titleFront } from './rules.ts';

import process from 'node:process';

export type Rules = {
  stopWords: string[];
  mustWords: string[];
  salaryMin: number;
  blacklist: string[];
};

export const EMPTY_RULES: Rules = { stopWords: [], mustWords: [], salaryMin: 0, blacklist: [] };

const STACK = [/nestjs|nest\.js/i, /node\.?js|\bnode\b/i, /typescript/i, /\bvue\b/i, /svelte/i, /\breact\b/i];
const RUB = /^(RUR|RUB)?$/i;

export function splitWords(text: string): string[] {
  return [...new Set(
    text
      .split(/[\n,;]+/)
      .map(word => word.trim())
      .filter(word => word.length > 0),
  )].slice(0, 60);
}

export function parseRules(raw: unknown): Rules {
  if (typeof raw !== 'object' || raw === null)
    return EMPTY_RULES;

  const rec = raw as Partial<Record<keyof Rules, unknown>>;

  return {
    stopWords: wordList(rec.stopWords),
    mustWords: wordList(rec.mustWords),
    salaryMin: typeof rec.salaryMin === 'number' && rec.salaryMin > 0 ? Math.floor(rec.salaryMin) : 0,
    blacklist: wordList(rec.blacklist),
  };
}

export function rulesFromEnv(): Rules {
  const raw = process.env.HH_RULES ?? '';
  if (raw.length === 0)
    return EMPTY_RULES;

  try {
    return parseRules(JSON.parse(raw));
  }
  catch {
    return EMPTY_RULES;
  }
}

export function searchTitleSkip(title: string, stopWords: readonly string[]): string | null {
  const text = title.trim();
  if (text.length === 0)
    return null;

  if (roleJunk(text))
    return 'не та роль';

  const stop = stopHit(text, stopWords);
  if (stop !== null)
    return `стоп-слово «${stop}»`;

  return hardSkip({
    id: '0',
    title: text,
    company: '',
    url: 'https://hh.ru/vacancy/0',
    text,
    formUrl: '',
    formBlocked: false,
    ...NO_META,
  });
}

export function keepSearchTitle(title: string, stopWords: readonly string[]): boolean {
  if (title.trim().length === 0)
    return false;

  return searchTitleSkip(title, stopWords) === null;
}

export function ruleSkip(vacancy: Vacancy, rules: Rules): string | null {
  const blob = `${vacancy.title}\n${vacancy.text}`.toLowerCase();
  const company = vacancy.company.toLowerCase();

  const banned = rules.blacklist.find(name => name === vacancy.employerId || company.includes(name.toLowerCase()));
  if (banned !== undefined)
    return 'компания в чёрном списке';

  const stop = stopWord(vacancy, rules.stopWords);
  if (stop !== undefined)
    return `стоп-слово «${stop}»`;

  if (rules.mustWords.length > 0 && rules.mustWords.some(word => blob.includes(word.toLowerCase())) === false)
    return 'нет нужных слов';

  const top = salaryTop(vacancy);
  if (rules.salaryMin > 0 && top !== null && top < rules.salaryMin)
    return `зарплата ниже ${rules.salaryMin}`;

  return null;
}

export function scoreOf(vacancy: Vacancy, rules: Rules): number {
  const blob = `${vacancy.title}\n${vacancy.text}`;
  const stack = STACK.filter(re => re.test(blob)).length;
  const top = salaryTop(vacancy);
  const paid = rules.salaryMin > 0 && top !== null && top >= rules.salaryMin ? 2 : 0;
  const senior = vacancy.experience === 'moreThan6' ? -2 : 0;

  return (vacancy.remote ? 3 : 0) + paid + stack + senior;
}

export function byScore(rules: Rules): (left: Vacancy, right: Vacancy) => number {
  return (left, right) => scoreOf(right, rules) - scoreOf(left, rules);
}

function stopWord(vacancy: Vacancy, stopWords: readonly string[]): string | undefined {
  const title = vacancy.title.toLowerCase();
  const inTitle = stopWords.find(word => word.length > 0 && title.includes(word.toLowerCase()));
  if (inTitle !== undefined)
    return inTitle;

  if (titleFront(vacancy.title))
    return undefined;

  const blob = `${vacancy.title}\n${vacancy.text}`.toLowerCase();

  return stopWords.find(word => word.length > 0 && blob.includes(word.toLowerCase()));
}

function stopHit(title: string, stopWords: readonly string[]): string | null {
  const hay = title.toLowerCase();

  return stopWords.find(word => word.length > 0 && hay.includes(word.toLowerCase())) ?? null;
}

function salaryTop(vacancy: Vacancy): number | null {
  if (RUB.test(vacancy.currency) === false)
    return null;

  const values = [vacancy.salaryFrom, vacancy.salaryTo].filter((value): value is number => typeof value === 'number' && value > 0);

  return values.length > 0 ? Math.max(...values) : null;
}

function wordList(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  return value.filter((word): word is string => typeof word === 'string' && word.trim().length > 0).map(word => word.trim()).slice(0, 60);
}

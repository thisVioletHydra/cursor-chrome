import type { Provider } from './model.ts';
import type { Vacancy } from './rules.ts';

import { FACTS } from './copy.ts';
import { askChain } from './model.ts';
import { storePath } from './memory.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import { createHash } from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

export const CORPUS_MAX = 100;

type Sample = { title: string; text: string; key: string };

type CorpusFile = { items: Sample[]; brief: string };

export function corpusOn(): boolean {
  return process.env.HH_CORPUS === '1';
}

export async function keepVacancy(vacancy: Pick<Vacancy, 'title' | 'text' | 'company'>): Promise<void> {
  if (corpusOn() === false)
    return;

  try {
    const sample = anonymous(vacancy);
    if (sample.text.length < 80)
      return;

    const file = await readCorpus();
    if (file.items.length >= CORPUS_MAX || file.items.some(row => row.key === sample.key))
      return;

    file.items.push(sample);
    await writeJsonAtomic(corpusPath(), file);
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'corpus');
  }
}

export async function corpusState(): Promise<{ count: number; brief: string }> {
  const file = await readCorpus();

  return { count: file.items.length, brief: file.brief };
}

export async function distillCorpus(chain: Provider[]): Promise<string> {
  const file = await readCorpus();
  if (file.items.length < CORPUS_MAX)
    throw new Error(`мало текстов: ${file.items.length} из ${CORPUS_MAX}`);

  const blob = file.items.map((row, index) => `--- ${index + 1}. ${row.title}\n${row.text}`).join('\n\n');
  const { text } = await askChain(chain, distillPrompt(blob), 90_000);
  const brief = text.trim();
  if (brief.length === 0)
    throw new Error('пустая выжимка');

  file.brief = brief;
  await writeJsonAtomic(corpusPath(), file);

  return brief;
}

function corpusPath(): string {
  return path.join(path.dirname(storePath()), 'corpus.json');
}

async function readCorpus(): Promise<CorpusFile> {
  let text: string;
  try {
    text = await fsPromises.readFile(corpusPath(), 'utf8');
  }
  catch {
    return { items: [], brief: '' };
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null || typeof parsed.value !== 'object' || parsed.value === null)
    return { items: [], brief: '' };

  const raw = parsed.value as { items?: unknown; brief?: unknown };
  const items = Array.isArray(raw.items) ? raw.items.flatMap(asSample) : [];

  return {
    items: items.slice(0, CORPUS_MAX),
    brief: typeof raw.brief === 'string' ? raw.brief : '',
  };
}

function asSample(value: unknown): Sample[] {
  if (typeof value !== 'object' || value === null)
    return [];

  const row = value as Partial<Sample>;
  if (typeof row.title !== 'string' || typeof row.text !== 'string' || typeof row.key !== 'string')
    return [];

  return [{ title: row.title, text: row.text, key: row.key }];
}

function anonymous(vacancy: Pick<Vacancy, 'title' | 'text' | 'company'>): Sample {
  const company = vacancy.company.trim();
  const drop = (value: string) => {
    let next = value.replace(/https?:\/\/\S+/gi, ' ');
    if (company.length > 2)
      next = next.split(company).join(' ');

    return next.replace(/\s+/g, ' ').trim();
  };
  const title = drop(vacancy.title).slice(0, 180);
  const text = drop(vacancy.text).slice(0, 4000);

  return {
    title,
    text,
    key: createHash('sha256').update(`${title}\n${text.slice(0, 500)}`).digest('hex').slice(0, 16),
  };
}

function distillPrompt(blob: string): string {
  return [
    'Перед тобой тексты вакансий без названий компаний. Сделай выжимку, чтобы человек поправил своё резюме.',
    'Три блока:',
    '1. Что рынок повторяет.',
    '2. Редфлаги формулировок на фоне этих вакансий.',
    '3. Эталон: как сказать то, что уже есть в фактах, языком этих вакансий.',
    'Не добавляй навыки, компании и цифры, которых нет в фактах. Не пиши само резюме на hh.',
    'Факты кандидата:',
    FACTS,
    blob.slice(0, 80_000),
  ].join('\n');
}

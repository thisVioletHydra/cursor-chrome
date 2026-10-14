// Server-side answer engine for the thin extension. The extension sends form fields + the user's context
// (profile, letter, facts, memory candidates it found locally by its index); the server decides.
// Order: rule → profile → human edit → memory → LLM fallback. Type check + score threshold 0.8.
// Personal questions never go to the LLM: «нужен твой ответ».
// Pure module: context lives only in this call's memory, nothing is logged or written.
import type { FormQuestion } from '../../../../../hh/src/review/form.ts';
import type { Profile, VacancyFacts } from '../../../../../hh/src/review/profile.ts';

import { closestChoice, questionKey } from '../../../../../hh/src/review/form.ts';
import { compatibleAnswer, lexicalScore } from '../../../../../hh/src/review/normalize.ts';
import { fillTemplate, isPersonalQuestion, NEED_HUMAN, parseProfile, profileAnswer } from '../../../../../hh/src/review/profile.ts';

export const ANSWER_MIN = 0.8;
export const ORDER = ['rule', 'profile', 'human', 'memory', 'llm'] as const;
export const MAX_FIELDS = 40;
export const MAX_CANDIDATES = 50;

export type Source = typeof ORDER[number];
export type FieldIn = { id: string; prompt: string; kind: 'text' | 'number' | 'choice'; options: string[] };
export type Candidate = { prompt: string; answer: string; human: boolean };
export type RuleIn = { title: string; aliases: string[]; answer: string };
export type AnswerContext = { profile: Profile | null; coverLetter: string; facts: string[]; rules: RuleIn[]; memory: Candidate[]; vacancy: VacancyFacts; formText: string };
export type FieldOut =
  | { id: string; answer: string; source: Source; from: string; score: number }
  | { id: string; human: true; reason: string };
export type Llm = (prompt: string) => Promise<string>;

const str = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max);
const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);

export function parseFields(raw: unknown): FieldIn[] {
  return list(raw, MAX_FIELDS).flatMap((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const prompt = str(row.prompt, 500).trim();
    const kind = row.kind === 'number' || row.kind === 'choice' ? row.kind : 'text';
    if (!prompt)
      return [];

    return [{ id: str(row.id, 80) || String(index), prompt, kind, options: list(row.options, 60).map(option => str(option, 200)).filter(Boolean) }];
  });
}

export function parseContext(raw: unknown): AnswerContext {
  const row = (raw ?? {}) as Record<string, unknown>;
  const vacancy = (row.vacancy ?? {}) as Record<string, unknown>;

  return {
    profile: parseProfile(row.profile),
    coverLetter: str(row.coverLetter, 5000),
    facts: list(row.facts, 100).map(item => str(item, 500)).filter(Boolean),
    rules: list(row.rules, MAX_CANDIDATES).map((item) => {
      const rule = (item ?? {}) as Record<string, unknown>;

      return { title: str(rule.title, 300), aliases: list(rule.aliases, 20).map(alias => str(alias, 300)).filter(Boolean), answer: str(rule.answer, 2000) };
    }).filter(rule => rule.title && rule.answer),
    memory: list(row.memory, MAX_CANDIDATES).map((item) => {
      const mem = (item ?? {}) as Record<string, unknown>;

      return { prompt: str(mem.prompt, 500), answer: str(mem.answer, 2000), human: mem.human === true };
    }).filter(mem => mem.prompt && mem.answer),
    vacancy: { title: str(vacancy.title, 300) || undefined, city: str(vacancy.city, 100) || undefined, company: str(vacancy.company, 200) || undefined },
    formText: str(row.formText, 1500),
  };
}

const asForm = (field: FieldIn): FormQuestion => ({ prompt: field.prompt, kind: field.kind, options: field.options, choices: [], multi: false, required: false, fieldKey: '' });

// Type check: numbers are digits only, choices must be one of the options.
export function fitType(field: FieldIn, answer: string): string | null {
  const text = answer.trim();
  if (!text)
    return null;

  if (field.kind === 'number') {
    const digits = text.replace(/\s/g, '');

    return /^\d{1,9}$/.test(digits) ? digits : null;
  }
  if (field.kind === 'choice')
    return closestChoice(asForm(field), text);

  return text.slice(0, 2000);
}

function best(field: FieldIn, items: Array<{ texts: string[]; answer: string; from: string }>): { answer: string; from: string; score: number } | null {
  const key = questionKey(field.prompt);
  let top: { answer: string; from: string; score: number } | null = null;
  for (const item of items) {
    if (compatibleAnswer(field.prompt, item.answer) === false)
      continue;

    for (const text of item.texts) {
      const score = questionKey(text) === key ? 1 : lexicalScore(field.prompt, text);
      if (score >= ANSWER_MIN && (top === null || score > top.score))
        top = { answer: item.answer, from: item.from, score: Math.round(score * 100) / 100 };
    }
  }

  return top;
}

// Local (deterministic) part: rule → profile → human edit → memory. null = nothing found.
export function decide(field: FieldIn, ctx: AnswerContext): FieldOut | { id: string; ask: 'llm' } {
  const typed = (answer: string, source: Source, from: string, score: number): FieldOut | null => {
    const fit = fitType(field, answer);

    return fit === null ? null : { id: field.id, answer: fit, source, from, score };
  };
  const rule = best(field, ctx.rules.map(item => ({ texts: [item.title, ...item.aliases], answer: item.answer, from: item.title })));
  const fromRule = rule && typed(fillTemplate(rule.answer, ctx.profile, ctx.vacancy), 'rule', rule.from, rule.score);
  if (fromRule)
    return fromRule;

  const own = profileAnswer(asForm(field), ctx.profile, ctx.vacancy);
  const fromProfile = own && own.source.score >= ANSWER_MIN ? typed(own.answer, 'profile', own.source.from, own.source.score) : null;
  if (fromProfile)
    return fromProfile;

  for (const human of [true, false]) {
    const hit = best(field, ctx.memory.filter(row => row.human === human).map(row => ({ texts: [row.prompt], answer: row.answer, from: row.prompt })));
    const out = hit && typed(hit.answer, human ? 'human' : 'memory', hit.from, hit.score);
    if (out)
      return out;
  }

  if (isPersonalQuestion(field.prompt))
    return { id: field.id, human: true, reason: `${NEED_HUMAN}: личный факт, его нет в профиле и памяти` };

  return { id: field.id, ask: 'llm' };
}

export function llmPrompt(field: FieldIn, ctx: AnswerContext): string {
  const shape = { text: 'Поле текстовое. Ответ одной-двумя фразами, до 300 знаков.', number: 'Поле числовое. Ответ только цифрами.', choice: `Поле с выбором. Ответ ровно один вариант из списка:\n${field.options.map(option => `- ${option}`).join('\n')}` }[field.kind];

  return [
    'Ты отвечаешь на вопрос работодателя в форме отклика на hh.ru от имени кандидата.',
    'Используй только факты ниже. Если ответа в фактах нет, верни human.',
    'Тестовое, задача, код, портфолио, «почему вы», «расскажите о себе»: human.',
    'Факты:',
    ...ctx.facts,
    ctx.formText ? `Текст формы:\n${ctx.formText}` : '',
    `Вопрос: ${field.prompt}`,
    shape,
    'Ответ одной строкой JSON: {"answer":"...","human":false} или {"human":true,"reason":"коротко"}',
  ].filter(Boolean).join('\n');
}

function parseLlm(text: string): { answer?: string; human?: boolean; reason?: string } {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    return match ? JSON.parse(match[0]) as { answer?: string; human?: boolean } : {};
  }
  catch {
    return {};
  }
}

export async function answerFields(fields: FieldIn[], ctx: AnswerContext, llm: Llm | null): Promise<FieldOut[]> {
  const out: FieldOut[] = [];
  for (const field of fields) {
    const local = decide(field, ctx);
    if ('ask' in local === false) {
      out.push(local as FieldOut);
      continue;
    }
    if (llm === null) {
      out.push({ id: field.id, human: true, reason: `${NEED_HUMAN}: нет ключа модели` });
      continue;
    }
    try {
      const reply = parseLlm(await llm(llmPrompt(field, ctx)));
      const fit = reply.human === true || typeof reply.answer !== 'string' ? null : fitType(field, reply.answer);
      out.push(fit === null ? { id: field.id, human: true, reason: `${NEED_HUMAN}: ${reply.reason ? String(reply.reason).slice(0, 120) : 'модель не нашла факта'}` } : { id: field.id, answer: fit, source: 'llm', from: 'llm', score: 0 });
    }
    catch {
      // provider errors may echo request data: never pass them through
      out.push({ id: field.id, human: true, reason: `${NEED_HUMAN}: модель не ответила` });
    }
  }

  return out;
}

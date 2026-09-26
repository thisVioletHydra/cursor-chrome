import type { Provider } from './model.ts';

import { FACTS } from './copy.ts';
import { askChain } from './model.ts';

export type QuestionKind = 'text' | 'number' | 'choice';

export type Question = {
  context: string;
  prompt: string;
  kind: QuestionKind;
  options: string[];
};

export type Answer = { answer: string } | { human: true; reason: string };

const ANSWER_MS = 20_000;
const MAX_TEXT = 400;

export async function answerQuestion(chain: Provider[], question: Question): Promise<Answer> {
  const { text } = await askChain(chain, answerPrompt(question), ANSWER_MS);

  return checkAnswer(question, parseAnswer(text));
}

export function answerPrompt(question: Question): string {
  const shape = {
    text: 'Поле текстовое. Ответ одной-двумя фразами, до 300 знаков, без приветствий и подписи.',
    number: 'Поле числовое. Ответ только цифрами.',
    choice: `Поле с выбором. Ответ — ровно один вариант из списка, слово в слово:\n${question.options.map(option => `- ${option}`).join('\n')}`,
  }[question.kind];

  return [
    'Ты отвечаешь на вопрос работодателя в форме отклика на hh.ru от имени кандидата.',
    'Используй только факты ниже. Если ответа в фактах нет — верни human.',
    'Зарплата: «по рынку, готов обсудить». Если поле числовое — 250000.',
    'Связь: Telegram @rtxRoman. Телефон и почту не пиши.',
    'Тестовое, задача, код, портфолио, «почему вы», «расскажите о себе» — human.',
    'Не выдумывай Python, Kubernetes, английский C1, гражданство.',
    'Факты:',
    FACTS,
    question.context.length > 0 ? `Текст формы работодателя:\n${question.context.slice(0, 1500)}` : '',
    `Вопрос: ${question.prompt}`,
    shape,
    'Ответ одной строкой JSON: {"answer":"...","human":false} или {"human":true,"reason":"коротко"}',
  ].filter(part => part.length > 0).join('\n');
}

export function parseAnswer(raw: string): Answer {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return { human: true, reason: 'модель не ответила' };

  let parsed: { answer?: unknown; human?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(match[0]) as typeof parsed;
  }
  catch {
    return { human: true, reason: 'модель не ответила' };
  }

  if (parsed.human === true || typeof parsed.answer !== 'string')
    return { human: true, reason: typeof parsed.reason === 'string' && parsed.reason.length > 0 ? parsed.reason : 'нет факта' };

  return { answer: parsed.answer.replace(/\s+/g, ' ').trim() };
}

export function checkAnswer(question: Question, answer: Answer): Answer {
  if ('human' in answer)
    return answer;

  if (answer.answer.length === 0)
    return { human: true, reason: 'пустой ответ' };

  if (question.kind === 'number')
    return /^\d{1,9}$/.test(answer.answer) ? answer : { human: true, reason: 'ответ не число' };

  if (question.kind === 'choice') {
    const hit = question.options.find(option => option.trim().toLowerCase() === answer.answer.toLowerCase());

    return hit ? { answer: hit } : { human: true, reason: 'вариант не из списка' };
  }

  return { answer: answer.answer.slice(0, MAX_TEXT) };
}

export function asQuestion(value: unknown): Question | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Record<string, unknown>;
  if (typeof row.prompt !== 'string' || row.prompt.trim().length === 0)
    return null;

  const kind = row.kind === 'number' || row.kind === 'choice' ? row.kind : 'text';
  const options = Array.isArray(row.options)
    ? row.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 30)
    : [];
  if (kind === 'choice' && options.length === 0)
    return null;

  return {
    context: typeof row.context === 'string' ? row.context.slice(0, 1500) : '',
    prompt: row.prompt.slice(0, 400),
    kind,
    options,
  };
}

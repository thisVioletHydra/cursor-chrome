// Answer a form question from local data only: rule → profile → human edit → memory → LLM fallback.
// Personal questions never go to the LLM: without local data they need the user's answer.
import type { LocalData } from './schema.ts';
import type { FormQuestion } from '../../../hh/src/review/form.ts';
import type { VacancyFacts } from '../../../hh/src/review/profile.ts';

import { closestChoice, questionKey } from '../../../hh/src/review/form.ts';
import { compatibleAnswer, LEXICAL_MIN, lexicalScore } from '../../../hh/src/review/normalize.ts';
import { fillTemplate, isPersonalQuestion, NEED_HUMAN, profileAnswer } from '../../../hh/src/review/profile.ts';

export type LocalSource = 'rule' | 'profile' | 'human' | 'memory';

export type LocalAnswer =
  | { kind: 'answer'; answer: string; source: LocalSource; from: string; score: number }
  | { kind: 'need-human'; why: string }
  // not personal and nothing local: the caller may ask the model with the question text only
  | { kind: 'ask-model' };

type Hit = { answer: string; from: string; score: number };

function bestOf(question: FormQuestion, items: Array<{ texts: string[]; answer: string; from: string }>): Hit | null {
  const key = questionKey(question.prompt);
  let best: Hit | null = null;
  for (const item of items) {
    if (compatibleAnswer(question.prompt, item.answer) === false)
      continue;

    const answer = closestChoice(question, item.answer);
    if (answer === null)
      continue;

    for (const text of item.texts) {
      const score = questionKey(text) === key ? 1 : lexicalScore(question.prompt, text);
      if (score >= LEXICAL_MIN && (best === null || score > best.score))
        best = { answer, from: item.from, score };
    }
  }

  return best;
}

export function localAnswer(question: FormQuestion, data: LocalData, vacancy: VacancyFacts = {}): LocalAnswer {
  const rule = bestOf(question, data.rules.map(item => ({ texts: [item.title, ...item.aliases], answer: item.answer, from: item.title })));
  if (rule) {
    const answer = fillTemplate(rule.answer, data.profile, vacancy).trim();
    if (answer)
      return { kind: 'answer', answer, source: 'rule', ...pick(rule) };
  }

  const own = profileAnswer(question, data.profile, vacancy);
  if (own)
    return { kind: 'answer', answer: own.answer, source: 'profile', from: own.source.from, score: own.source.score };

  const asMemory = (human: boolean) => bestOf(question, data.memory.filter(row => (row.human === true) === human).map(row => ({ texts: [row.prompt], answer: row.answer, from: row.prompt })));
  const human = asMemory(true);
  if (human)
    return { kind: 'answer', answer: human.answer, source: 'human', ...pick(human) };

  const memory = asMemory(false);
  if (memory)
    return { kind: 'answer', answer: memory.answer, source: 'memory', ...pick(memory) };

  if (isPersonalQuestion(question.prompt))
    return { kind: 'need-human', why: `${NEED_HUMAN}: личный факт, его нет в профиле и памяти` };

  return { kind: 'ask-model' };
}

function pick(hit: Hit) {
  return { from: hit.from, score: Math.round(hit.score * 100) / 100 };
}

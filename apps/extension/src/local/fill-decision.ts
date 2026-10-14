// apply-fill step: local data first (rule → profile → human edit → memory). Personal questions without local
// data → «нужен твой ответ». Only non-personal questions with nothing local go to the cloud (question text only).
// No local data imported yet → legacy cloud path unchanged.
import type { LocalData } from './schema.ts';
import type { VacancyFacts } from '../../../hh/src/review/profile.ts';

import { localAnswer } from './answer.ts';

export type FillQuestion = { prompt: string; kind: 'text' | 'number' | 'choice'; options: string[] };

export type FillDecision =
  | { use: 'local'; answer: string; source: string; from: string }
  | { use: 'human'; reason: string }
  | { use: 'cloud' };

export function decideFill(question: FillQuestion, data: LocalData | null, vacancy: VacancyFacts = {}): FillDecision {
  if (data === null)
    return { use: 'cloud' };

  const form = { prompt: question.prompt, kind: question.kind, options: question.options, choices: [], multi: false, required: false, fieldKey: '' };
  const found = localAnswer(form, data, vacancy);
  if (found.kind === 'answer') {
    if (question.kind === 'number' && /^\d{1,9}$/.test(found.answer.replace(/\s/g, '')) === false)
      return { use: 'human', reason: `${question.prompt}: нужен твой ответ (нужно число)` };

    return { use: 'local', answer: question.kind === 'number' ? found.answer.replace(/\s/g, '') : found.answer, source: found.source, from: found.from };
  }

  if (found.kind === 'need-human')
    return { use: 'human', reason: `${question.prompt}: нужен твой ответ` };

  return { use: 'cloud' };
}

export const FULL_LOOKUP = 'local-full-answer';

// Index first (content script); if nothing local was found and the full memory lives in IndexedDB,
// ask the background (full rows) before falling back to «нужен твой ответ» / cloud.
export async function decideWithIndex(
  question: FillQuestion,
  indexed: { data: LocalData; hasLong: boolean } | null,
  vacancy: VacancyFacts,
  askFull: (question: FillQuestion, vacancy: VacancyFacts) => Promise<FillDecision | null>,
): Promise<FillDecision & { via: 'index' | 'idb' | 'none' }> {
  const first = decideFill(question, indexed?.data ?? null, vacancy);
  if (first.use === 'local')
    return { ...first, via: 'index' };

  if (indexed?.hasLong) {
    const full = await askFull(question, vacancy).catch(() => null);
    if (full && full.use === 'local')
      return { ...full, via: 'idb' };
  }

  return { ...first, via: 'none' };
}

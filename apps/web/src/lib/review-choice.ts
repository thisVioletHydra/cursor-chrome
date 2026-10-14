import type { FormQuestion } from '@cursor-chrome/hh';

// Client-safe copies of the hh helpers (the hh package pulls node:sqlite, so it can't ship to the browser).
export const MULTI_SEP = '; ';

export function isChoice(question: Pick<FormQuestion, 'kind' | 'options'>): boolean {
  return (question.kind === 'choice' || question.kind === 'multi') && question.options.length > 0;
}

// Value equality for the «изменено вручную» badge: texts trimmed with collapsed spaces,
// multi-choice compared as sets, single choice by label.
export function sameAnswer(question: Pick<FormQuestion, 'kind' | 'options' | 'multi'>, left: string, right: string): boolean {
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  if (isChoice(question) && question.multi) {
    const set = (text: string) => new Set(text.split(/\s*;\s*/).map(clean).filter(item => item.length > 0));
    const a = set(left);
    const b = set(right);

    return a.size === b.size && [...a].every(item => b.has(item));
  }

  return clean(left) === clean(right);
}

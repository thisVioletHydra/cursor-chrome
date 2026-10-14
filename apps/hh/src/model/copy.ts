// Cover letter is account data (account.coverLetter); empty default, filled from the owner account at start.
export let COVER_LETTER = '';

export function setCoverLetter(text: string | null | undefined): void {
  COVER_LETTER = String(text ?? '').trim();
}

// Owner answers used by auto-answers (answer.ts); come from the profile (salary, salaryNumber, contacts).
export type AnswerHints = { salary: string; salaryNumber: string; contacts: string };

export let ANSWER_HINTS: AnswerHints = { salary: '', salaryNumber: '', contacts: '' };

export function setAnswerHints(hints: Partial<AnswerHints> | null): void {
  ANSWER_HINTS = { salary: String(hints?.salary ?? '').trim(), salaryNumber: String(hints?.salaryNumber ?? '').replace(/\D/g, ''), contacts: String(hints?.contacts ?? '').trim() };
}

// Personal facts are account data now (account field `facts`: { rules, notes, resume }); code keeps empty defaults.
// FACTS = rules for auto-answers (same role as before), PROFILE_NOTES = notes + resume for the «Разбор» drafts.
// Live bindings: setAccountFacts() fills them from the owner account at server start; per-user drafts pass facts explicitly.
export type AccountFacts = { rules: string[]; notes: string; resume: string };

export const EMPTY_FACTS: AccountFacts = { rules: [], notes: '', resume: '' };

export let FACTS = '';

export let PROFILE_NOTES = '';

export function parseFacts(raw: unknown): AccountFacts {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    }
    catch {
      value = null;
    }
  }
  if (typeof value !== 'object' || value === null)
    return { ...EMPTY_FACTS };

  const row = value as { rules?: unknown; notes?: unknown; resume?: unknown };

  return {
    rules: (Array.isArray(row.rules) ? row.rules : []).map(item => String(item).trim()).filter(item => item.length > 0).slice(0, 100),
    notes: String(row.notes ?? '').slice(0, 8_000),
    resume: String(row.resume ?? '').slice(0, 16_000),
  };
}

export function factsText(facts: AccountFacts): string {
  return facts.rules.join('\n');
}

export function notesText(facts: AccountFacts): string {
  return [facts.notes, facts.resume].filter(part => part.length > 0).join('\n\n');
}

export function setAccountFacts(facts: AccountFacts | null): void {
  FACTS = factsText(facts ?? EMPTY_FACTS);
  PROFILE_NOTES = notesText(facts ?? EMPTY_FACTS);
}

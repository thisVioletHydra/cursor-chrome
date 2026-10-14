export type FormKind = 'text' | 'number' | 'choice' | 'multi' | 'unknown';

export type FormChoice = { value: string; label: string };

export type FormQuestion = {
  prompt: string;
  kind: FormKind;
  options: string[];
  choices: FormChoice[];
  multi: boolean;
  required: boolean;
  fieldKey: string;
};

export type CapturedForm = {
  questions: FormQuestion[];
  text: string;
  url: string;
  at: number;
};

const KINDS: readonly FormKind[] = ['text', 'number', 'choice', 'multi', 'unknown'];
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 30;
const MAX_PROMPT = 1_000;
const MAX_TEXT = 6_000;

export function asCapturedForm(raw: unknown): CapturedForm | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const row = raw as Record<string, unknown>;
  const list = Array.isArray(row.questions) ? row.questions : [];
  const questions = list.slice(0, MAX_QUESTIONS).map(asQuestion).filter((item): item is FormQuestion => item !== null);
  if (questions.length === 0)
    return null;

  return {
    questions,
    text: clip(row.text, MAX_TEXT),
    url: clip(row.url, 500),
    at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : Date.now(),
  };
}

function asQuestion(raw: unknown): FormQuestion | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const row = raw as Record<string, unknown>;
  const prompt = clip(row.prompt, MAX_PROMPT);
  if (prompt.length === 0)
    return null;

  const kind = KINDS.includes(row.kind as FormKind) ? row.kind as FormKind : 'unknown';
  const stored = Array.isArray(row.choices) ? row.choices.map(asChoice).filter((item): item is FormChoice => item !== null).slice(0, MAX_OPTIONS) : [];
  const labels = Array.isArray(row.options) ? row.options.map(item => clip(item, 300)).filter(item => item.length > 0).slice(0, MAX_OPTIONS) : [];
  // Legacy rows only had option labels: the label doubles as the value.
  const choices = stored.length > 0 ? stored : labels.map(label => ({ value: label, label }));
  const options = choices.map(choice => choice.label);
  const multi = row.multi === true || kind === 'multi';

  return { prompt, kind: multi && choices.length > 0 ? 'multi' : kind, options, choices, multi, required: row.required === true, fieldKey: clip(row.fieldKey, 200) };
}

function asChoice(raw: unknown): FormChoice | null {
  if (typeof raw === 'string')
    return raw.trim().length > 0 ? { value: clip(raw, 300), label: clip(raw, 300) } : null;

  if (typeof raw !== 'object' || raw === null)
    return null;

  const row = raw as Record<string, unknown>;
  const label = clip(row.label, 300);
  const value = clip(row.value, 300) || label;

  return label.length > 0 ? { value, label } : null;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function questionKey(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 300);
}

export function hintQuestions(hints: readonly string[]): FormQuestion[] {
  return hints
    .map(hint => hint.replace(/\s+/g, ' ').trim())
    .filter(hint => hint.length >= 8 && hint !== 'вопросы работодателя')
    .map(prompt => ({ prompt, kind: 'unknown' as const, options: [], choices: [], multi: false, required: false, fieldKey: '' }));
}

export function isChoice(question: Pick<FormQuestion, 'kind' | 'options'>): boolean {
  return (question.kind === 'choice' || question.kind === 'multi') && question.options.length > 0;
}

export const MULTI_SEP = '; ';

// A stored answer fits a choice question only when every picked label is one of its options.
export function fitChoice(question: Pick<FormQuestion, 'kind' | 'options' | 'multi'>, answer: string): string | null {
  if (isChoice(question) === false)
    return answer;

  const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const picks = (question.multi ? answer.split(/\s*;\s*/) : [answer]).map(norm).filter(item => item.length > 0);
  const hits = picks.map(pick => question.options.find(option => norm(option) === pick));
  if (hits.length === 0 || hits.some(hit => hit === undefined))
    return null;

  return hits.join(MULTI_SEP);
}

const YES = /^(да|yes|готов|согласен|согласна|конечно|возможно при|только|при условии|если|за оплату)/;
const NO = /^(нет|no|не |не$|никак|отказ)/;

function normChoice(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function words(text: string): Set<string> {
  return new Set(normChoice(text).split(' ').filter(word => word.length > 2).map(word => word.slice(0, 6)));
}

// Map a free-text answer onto the closest option of a choice question: exact → containment →
// shared words → yes/no polarity («Только оплачиваемое» → «Да» when the form only has Да/Нет).
// Returns null when nothing is plausibly close, so foreign answers are still refused.
export function closestChoice(question: Pick<FormQuestion, 'kind' | 'options' | 'multi'>, answer: string): string | null {
  const strict = fitChoice(question, answer);
  if (strict !== null || isChoice(question) === false)
    return strict;

  const parts = (question.multi ? answer.split(/\s*[;,]\s*/) : [answer]).map(normChoice).filter(item => item.length > 0);
  const picked = parts.map((part) => {
    const exact = question.options.find(option => normChoice(option) === part);
    if (exact)
      return exact;

    const contained = question.options.find(option => normChoice(option).length > 1 && (part.includes(normChoice(option)) || normChoice(option).includes(part)));
    if (contained)
      return contained;

    const mine = words(part);
    const scored = question.options.map(option => ({ option, shared: [...words(option)].filter(word => mine.has(word)).length })).sort((left, right) => right.shared - left.shared);
    if (scored[0] && scored[0].shared > 0)
      return scored[0].option;

    const yes = question.options.find(option => /^(да|yes)$/i.test(normChoice(option)));
    const no = question.options.find(option => /^(нет|no)$/i.test(normChoice(option)));
    if (NO.test(part) && no)
      return no;

    if (YES.test(part) && yes)
      return yes;

    return undefined;
  });
  if (picked.length === 0 || picked.some(item => item === undefined))
    return null;

  return question.options.filter(option => picked.includes(option)).join(MULTI_SEP);
}

export const EMPLOYER_REASON = 'вопросы работодателя';

const ASK_CAP = 6;
const ASK_LEN = 180;
const LINE_LEN = 220;
const GENERIC = new Set([EMPLOYER_REASON, 'вопросы работодателя, обязательные поля']);

export function employerHints(questions: readonly string[]): string[] {
  const clean = [...new Set(questions.map(row => row.replace(/\s+/g, ' ').trim()).filter(row => row.length >= 8))];

  return clean.slice(0, ASK_CAP).map(row => (row.length > ASK_LEN ? `${row.slice(0, ASK_LEN - 1)}…` : row));
}

export function waiterLine(hints: readonly string[], reason = ''): string {
  const why = waiterBits(hints, reason).slice(0, 3).join('; ');
  if (why.length === 0)
    return 'ждёт тебя';

  const text = `ждёт тебя: ${why}`;

  return text.length > LINE_LEN ? `${text.slice(0, LINE_LEN - 1)}…` : text;
}

export function waiterBits(hints: readonly string[], reason = ''): string[] {
  const rows = hints.map(row => row.replace(/\s+/g, ' ').trim()).filter(row => row.length > 0);
  const specific = rows.filter(row => GENERIC.has(row) === false);
  const shown = specific.length > 0 ? specific : rows;
  if (shown.length > 0)
    return shown;

  const fallback = reason.replace(/\s+/g, ' ').trim();

  return fallback.length > 0 ? [fallback] : [];
}

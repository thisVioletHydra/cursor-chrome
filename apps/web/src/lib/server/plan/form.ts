import type { Answer } from './types.ts';

// Apply form: selectors and parsing, ported (read-only) from extension hh/screen-questions.ts,
// hh/apply-fill.ts and web thin/config.ts. Parsing runs on HTML the extension's snapshot returns.
export const FORM_SEL = {
  root: '[data-qa="vacancy-response-popup"], [data-qa*="response-popup"], [data-qa*="vacancy-response"], [data-qa="vacancy-response-view"]',
  taskQuestion: '[data-qa="task-question"]',
  letterToggle: '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"]',
  letterField: 'textarea[data-qa*="letter"], [data-qa*="letter"] textarea, textarea[name*="letter"]',
  applyButton: '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]',
  submitButton: '[data-qa="vacancy-response-submit-popup"]',
  field: 'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])',
} as const;

const PAGE_ASK = /для отклика необходимо ответить на несколько вопросов/i;
const CUSTOM_MARK = /крипт|usdt|btc|игр[аыуе]|портфолио|тест|задач|почему\s+вы|расскажите|github|кейс|пазл|quiz|код[ауе]?\b/i;

export interface FormField { id: string; label: string; kind: 'text' | 'choice' | 'select'; options: string[]; custom: boolean; required: boolean }
export interface ParsedForm { fields: FormField[]; letter: boolean; questionnaire: boolean }

const strip = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export function parseForm(html: string): ParsedForm {
  const blocks = html.split('data-qa="task-question"').slice(1);
  const fields: FormField[] = blocks.map((raw, item) => {
    const end = raw.search(/data-qa="task-question"|<\/form>/);
    const chunk = end > 0 ? raw.slice(0, end) : raw.slice(0, 8000);
    const body = chunk.slice(chunk.indexOf('>') + 1);
    const name = chunk.match(/<(?:textarea|input|select)[^>]*\bname="([^"]+)"/)?.[1];
    const label = strip(body.split(/<(?:textarea|input|select|label)\b/)[0]).slice(0, 500);
    const select = /<select\b/.test(chunk);
    const options = select
      ? [...chunk.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m => strip(m[1])).filter(Boolean)
      : [...chunk.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map(m => strip(m[1])).filter(Boolean);
    const radio = /type="(?:radio|checkbox)"|role="radio"/.test(chunk);
    return { id: name ?? `task-${item}`, label, kind: select ? 'select' : radio ? 'choice' : 'text', options: select || radio ? options : [], custom: CUSTOM_MARK.test(label), required: /\brequired\b|aria-required="true"/.test(chunk) };
  });
  return { fields, letter: /data-qa="[^"]*letter|name="[^"]*letter/.test(html), questionnaire: PAGE_ASK.test(strip(html)) };
}

// needsHuman rule (lead decision): empty answer on a required field, or a choice that matches no option.
export function fieldProblems(fields: unknown[], answers: unknown[]): { id: string; reason: string }[] {
  const byId = new Map<string, unknown>();
  for (const a of answers) {
    const r = a as { id?: unknown; name?: unknown; value?: unknown; answer?: unknown };
    const id = typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : '';
    if (id) byId.set(id, r.value ?? r.answer);
  }

  const out: { id: string; reason: string }[] = [];
  for (const raw of fields) {
    const f = raw as Partial<FormField> & { name?: string };
    const id = f.id ?? f.name ?? '';
    const v = byId.get(id);
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required === true) out.push({ id, reason: `нет ответа на обязательное поле: ${f.label ?? id}` });

      continue;
    }

    const opts = Array.isArray(f.options) ? f.options.map(o => String(o).trim().toLowerCase()) : [];
    if ((f.kind === 'choice' || f.kind === 'select') && opts.length > 0) {
      const vals = (Array.isArray(v) ? v : [v]).map(x => String(x).trim().toLowerCase());
      if (vals.some(x => opts.includes(x) === false)) out.push({ id, reason: `вариант не совпал: ${f.label ?? id}` });
    }
  }

  return out;
}

// Sets human: true (with reason) on answers that are empty for a required field or match no option.
export function markHuman(fields: unknown[], answers: Answer[]): Answer[] {
  const bad = new Map(fieldProblems(fields, answers).map(p => [p.id, p.reason]));
  const out = answers.map(a => (bad.has(a.id) ? { ...a, human: true, reason: a.reason ?? bad.get(a.id) } : a));
  for (const [id, reason] of bad)
    if (out.some(a => a.id === id) === false) out.push({ id, human: true, reason });

  return out;
}

export function answerProblem(fields: unknown[], answers: unknown[]): string {
  const first = fieldProblems(fields, answers)[0];
  if (first !== undefined)
    return first.reason;

  return answers.some(a => (a as Answer | null)?.human === true) ? 'нужен твой ответ: проверь Разбор' : '';
}

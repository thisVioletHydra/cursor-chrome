import type { FormQuestion } from './form.ts';
import type { DraftSource } from './store.ts';
import type { VacancyInfo } from './vacancy.ts';

import { closestChoice, isChoice, questionKey } from './form.ts';
import { lexicalScore, normalizeText } from './normalize.ts';
import { LEXICAL_MIN } from './normalize.ts';
import { PROFILE_QUESTIONS } from './profile-questions.ts';

// ---- Generic conditional rules: a value that depends on vacancy data ----

export type VacancyField = 'city' | 'title' | 'company' | 'format' | 'salary' | 'office';
export type CondOp = 'is' | 'isNot' | 'contains' | 'gte' | 'lte';
export type Cond = { field: VacancyField; op: CondOp; value: string };
export type RuleCase = { when: Cond[]; value: string };

// fixed: always `value`; vacancy: copy a vacancy field; conditions: first case whose conditions all hold, else `otherwise`.
export type ValueRule =
  | { mode: 'fixed'; value: string }
  | { mode: 'vacancy'; field: VacancyField; fallback?: string }
  | { mode: 'conditions'; cases: RuleCase[]; otherwise: string };

export type ProfileCustom = { key: string; label: string; aliases: string[] };

export type Profile = { version: 1; savedAt: number; fields: Record<string, ValueRule>; custom: ProfileCustom[] };

export type VacancyFacts = Partial<Pick<VacancyInfo, 'city' | 'title' | 'company' | 'format' | 'salaryFrom' | 'salaryTo' | 'office'>>;

const norm = (text: string) => normalizeText(String(text ?? ''));

function fieldOf(facts: VacancyFacts, field: VacancyField): string {
  if (field === 'salary')
    return String(facts.salaryTo ?? facts.salaryFrom ?? '');

  if (field === 'office')
    return facts.office === true ? 'да' : facts.office === false ? 'нет' : '';

  return String(facts[field] ?? '');
}

export function holds(cond: Cond, facts: VacancyFacts): boolean {
  const left = fieldOf(facts, cond.field);
  const a = norm(left);
  const b = norm(cond.value);
  switch (cond.op) {
    case 'is': return a.length > 0 && a === b;
    case 'isNot': return a !== b;
    case 'contains': return b.length > 0 && a.includes(b);
    case 'gte': return left !== '' && Number(left) >= Number(cond.value);
    case 'lte': return left !== '' && Number(left) <= Number(cond.value);
    default: return false;
  }
}

export function evaluateRule(rule: ValueRule | undefined, facts: VacancyFacts): string {
  if (rule === undefined)
    return '';

  if (rule.mode === 'fixed')
    return rule.value.trim();

  if (rule.mode === 'vacancy')
    return fieldOf(facts, rule.field).trim() || (rule.fallback ?? '').trim();

  const hit = rule.cases.find(item => item.when.length > 0 && item.when.every(cond => holds(cond, facts)));

  return (hit ? hit.value : rule.otherwise).trim();
}

// Templates usable in canon answers: {{profile.city}}, {{vacancy.city}}.
export function fillTemplate(text: string, profile: Profile | null, facts: VacancyFacts): string {
  return text.replace(/\{\{\s*(profile|vacancy)\.([\w-]+)\s*\}\}/g, (_, scope: string, key: string) => (scope === 'profile'
    ? evaluateRule(profile?.fields[key], facts)
    : fieldOf(facts, key as VacancyField)));
}

// ---- Parsing (account data is untrusted JSON) ----

const FIELDS = new Set<VacancyField>(['city', 'title', 'company', 'format', 'salary', 'office']);
const OPS = new Set<CondOp>(['is', 'isNot', 'contains', 'gte', 'lte']);
const str = (value: unknown, max = 500) => String(value ?? '').slice(0, max);

function ruleOf(raw: unknown): ValueRule | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const row = raw as Record<string, unknown>;
  if (row.mode === 'fixed')
    return { mode: 'fixed', value: str(row.value, 2_000) };

  if (row.mode === 'vacancy' && FIELDS.has(row.field as VacancyField))
    return { mode: 'vacancy', field: row.field as VacancyField, fallback: str(row.fallback) };

  if (row.mode === 'conditions') {
    const cases = (Array.isArray(row.cases) ? row.cases : []).slice(0, 20).flatMap((item: unknown) => {
      const one = item as { when?: unknown; value?: unknown } | null;
      const when = (Array.isArray(one?.when) ? one.when : []).flatMap((cond: unknown) => {
        const c = cond as Record<string, unknown> | null;

        return c && FIELDS.has(c.field as VacancyField) && OPS.has(c.op as CondOp) ? [{ field: c.field as VacancyField, op: c.op as CondOp, value: str(c.value) }] : [];
      });

      return when.length > 0 ? [{ when, value: str(one?.value, 2_000) }] : [];
    });

    return { mode: 'conditions', cases, otherwise: str(row.otherwise, 2_000) };
  }

  return null;
}

export function parseProfile(raw: unknown): Profile | null {
  const value = typeof raw === 'string' ? (() => {
    try {
      return JSON.parse(raw) as unknown;
    }
    catch {
      return null;
    }
  })() : raw;
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as { savedAt?: unknown; fields?: unknown; custom?: unknown };
  const fields: Record<string, ValueRule> = {};
  for (const [key, rule] of Object.entries(typeof row.fields === 'object' && row.fields !== null ? row.fields : {}).slice(0, 100)) {
    const parsed = ruleOf(rule);
    if (parsed && /^[\w-]{1,40}$/.test(key))
      fields[key] = parsed;
  }
  const custom = (Array.isArray(row.custom) ? row.custom : []).slice(0, 50).flatMap((item: unknown) => {
    const c = item as Record<string, unknown> | null;
    const key = str(c?.key, 40);
    const label = str(c?.label, 200).trim();

    return /^[\w-]{1,40}$/.test(key) && label.length > 0 ? [{ key, label, aliases: (Array.isArray(c?.aliases) ? c.aliases : []).map(item2 => str(item2, 300).trim()).filter(Boolean).slice(0, 20) }] : [];
  });

  return { version: 1, savedAt: Number(row.savedAt) || 0, fields, custom };
}

// ---- Profile → answer for a form question ----

export type ProfileHit = { answer: string; source: DraftSource };

export function profileQuestions(profile: Profile | null): Array<{ key: string; label: string; aliases: string[] }> {
  return [...PROFILE_QUESTIONS, ...(profile?.custom ?? []).map(item => ({ ...item, aliases: [item.label, ...item.aliases] }))];
}

export function profileAnswer(question: FormQuestion, profile: Profile | null, facts: VacancyFacts): ProfileHit | null {
  if (profile === null)
    return null;

  const key = questionKey(question.prompt);
  let best: { field: string; label: string; score: number; text: string } | null = null;
  for (const item of profileQuestions(profile)) {
    for (const text of item.aliases) {
      const score = questionKey(text) === key ? 1 : lexicalScore(question.prompt, text);
      if (score >= LEXICAL_MIN && (best === null || score > best.score))
        best = { field: item.key, label: item.label, score, text };
    }
  }
  if (best === null)
    return null;

  const raw = evaluateRule(profile.fields[best.field], facts);
  if (raw.length === 0)
    return null;

  const answer = isChoice(question) ? closestChoice(question, raw) : raw;
  if (answer === null)
    return null;

  return { answer, source: { kind: 'profile', target: `p:${best.field}`, from: best.label, score: Math.round(best.score * 100) / 100, method: profile.fields[best.field]?.mode ?? 'fixed' } };
}

// ---- No fabrication: questions about the person that only the person can answer ----

const PERSONAL = /(город|проживаете|находитесь|гражданств|гражданин|паспорт|документ|трудов|выписк|стд р|диплом|релокац|переезд|переехать|возраст|лет вам|дата рождения|семейн|адрес|телефон|почт|военн|снилс|инн|разрешени на работу|зарплат|доход|ожидани|приступить|выйти на работу|дата выхода|уровень английск)/;

export function isPersonalQuestion(prompt: string): boolean {
  return PERSONAL.test(normalizeText(prompt).replace(/ё/g, 'е'));
}

export const NEED_HUMAN = 'нужен твой ответ';

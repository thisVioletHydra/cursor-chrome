import type { ApplyBlock } from './apply-detect';

import { typeInto } from '../page/actions';
import { applyBlocker } from './apply-detect';
import { compact, sleep, until, visible } from './dom';
import { coverLetter } from './letter';
import { ensureFullstack } from './resume';
import { applyRoot, isCoverLetter, isStandardQuestion, promptFields } from './screen-questions';

export type FillFail = {
  ok: false;
  status: 'skip' | 'needsHuman';
  reason: string;
  hints?: string[];
};

type QuestionKind = 'city' | 'pay' | 'ip' | 'open' | 'schedule' | 'contact' | 'citizen';

const KIND_RE: Array<[QuestionKind, RegExp]> = [
  ['ip', /ип|самозанят|\bгпх\b|контрагент/i],
  ['city', /где.{0,32}(работ|жив)|локаци|\bгород/i],
  ['schedule', /график|формат работ/i],
  ['open', /вакансия\s+открыт/i],
  ['pay', /оплат|зарплат|ожидан/i],
  ['contact', /как\s+(с\s+вами\s+)?связат|способ\s+связи|телефон|e-?mail/i],
  ['citizen', /гражданств/i],
];

const FILL: Record<QuestionKind, (block: HTMLElement) => Promise<boolean>> = {
  city: block => typeOrClick(block, 'Бишкек', /бишкек/i),
  pay: block => typeOrClick(block, 'по рынку', /рынк|договорён|договорен/i),
  ip: block => clickChoice(block, /^(да|yes)\b/i),
  open: block => clickChoice(block, /^(да|yes)\b/i),
  schedule: block => clickChoice(block, /удал|remote|дистанц|гибк/i),
  contact: async () => true,
  citizen: block => typeOrClick(block, 'Кыргызстан', /кыргыз|киргиз/i).then(ok => ok || clickChoice(block, /^(нет|no)\b/i)),
};

export async function fillApply(): Promise<FillFail | null> {
  const resumeOk = await ensureFullstack();
  if (resumeOk === false)
    return { ok: false, status: 'skip', reason: 'нет резюме Fullstack-разработчик' };

  const letterOk = await insertLetter();
  if (letterOk === false)
    return { ok: false, status: 'skip', reason: 'нет поля сопроводительного' };

  return fillQuestions();
}

async function fillQuestions(): Promise<FillFail | null> {
  for (const row of promptFields()) {
    const kind = KIND_RE.find(([, re]) => re.test(row.prompt))?.[0];
    const skip = kind === undefined || isStandardQuestion(row.prompt) === false;
    if (skip)
      continue;

    const ok = await FILL[kind](row.root);
    if (ok === false && kind !== 'contact')
      return humanFail(`не заполнил: ${row.prompt}`, [row.prompt]);
  }

  const blocked = applyBlocker();
  if (blocked)
    return humanFail(blocked.reason, blocked.hints);

  return null;
}

function humanFail(reason: string, hints: string[]): FillFail {
  return { ok: false, status: 'needsHuman', reason, hints };
}

async function insertLetter(): Promise<boolean> {
  await openLetter();
  const field = letterField();
  if (field === null)
    return false;

  const letter = await coverLetter();
  typeInto(field, letter, false);

  return fieldHasLetter(field, letter);
}

async function openLetter(): Promise<void> {
  if (letterField())
    return;

  letterToggle()?.click();
  await until(() => letterField() !== null, 4000);
}

function letterField(): HTMLElement | null {
  const named = document.querySelector<HTMLElement>([
    'textarea[data-qa*="letter"]',
    'textarea[name*="letter"]',
    '[data-qa*="letter"] textarea',
  ].join(','));
  if (named && visible(named))
    return named;

  return [...document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')]
    .find(element => visible(element) && isCoverLetter(element)) ?? null;
}

function letterToggle(): HTMLElement | null {
  const qa = document.querySelector<HTMLElement>('[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"]');
  if (qa && visible(qa))
    return qa;

  const root = applyRoot();
  if (root === null)
    return null;

  return [...root.querySelectorAll<HTMLElement>('button, a, [role="button"]')]
    .find(element => /добавить сопроводительн|сопроводительное письмо/i.test(compact(element.textContent || ''))) ?? null;
}

function fieldHasLetter(field: HTMLElement, letter: string): boolean {
  const value = field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
    ? field.value
    : (field.textContent || '');
  const head = compact(letter).slice(0, 40);

  return compact(value).includes(head);
}

async function typeOrClick(block: HTMLElement, text: string, re: RegExp): Promise<boolean> {
  if (clickChoice(block, re))
    return true;

  return typeFirst(block, text, re);
}

function clickChoice(block: HTMLElement, re: RegExp): boolean {
  const nodes = [...block.querySelectorAll<HTMLElement>('label, [role="radio"], [role="option"], button, li')];
  const hit = nodes.find((element) => {
    const text = compact(element.textContent || '');

    return text.length > 0 && text.length < 80 && re.test(text);
  });
  if (hit) {
    hit.click();

    return true;
  }

  return selectMatch(block, re);
}

function selectMatch(block: HTMLElement, re: RegExp): boolean {
  const select = block.querySelector('select');
  const opt = select ? [...select.options].find(item => re.test(item.text)) : undefined;
  if (select === null || opt === undefined)
    return false;

  select.value = opt.value;
  select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}

async function typeFirst(block: HTMLElement, text: string, re: RegExp): Promise<boolean> {
  const field = block.querySelector<HTMLElement>('textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])');
  if (field === null)
    return false;

  typeInto(field, text, false);
  await sleep(400);
  const opt = [...document.querySelectorAll<HTMLElement>('[role="option"], [data-qa*="suggest"]')]
    .find(element => re.test(element.textContent || ''));
  opt?.click();

  return true;
}

export function asHumanBlock(fail: FillFail): ApplyBlock {
  return { reason: fail.reason, hints: fail.hints || [fail.reason] };
}

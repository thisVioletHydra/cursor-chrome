import type { ApplyBlock } from './apply-detect';
import type { CapturedForm } from './form-capture';

import { typeInto } from '../page/actions';
import { applyBlocker, captchaOnPage } from './apply-detect';
import { ask } from './bridge';
import { compact, pause, until, visible } from './dom';
import { coverLetter } from './letter';
import { localStore } from '../local/chrome-store';
import { standardValue, valueRe } from '../local/standard-fill';
import type { StandardKind } from '../local/standard-fill';
import { noteLive } from './live-log';
import { BUILTIN, cachedConfig, selector } from '../local/config-cache';
import { browser } from '../browser-host';
import { pickResume, resumeKind, vacancyBody, vacancyTitle } from './resume';
import { applyRoot, employerQuestionnaire, isCoverLetter, isStandardQuestion, promptFields } from './screen-questions';

export type FillFail = {
  ok: false;
  status: 'skip' | 'needsHuman';
  reason: string;
  hints?: string[];
  form?: CapturedForm;
};

type QuestionKind = 'city' | 'pay' | 'ip' | 'open' | 'schedule' | 'citizen';

const KIND_RE: Array<[QuestionKind, RegExp]> = [
  ['ip', /ип|самозанят|\bгпх\b|контрагент/i],
  ['city', /где.{0,32}(работ|жив)|локаци|\bгород/i],
  ['schedule', /график|формат работ/i],
  ['open', /вакансия\s+открыт/i],
  ['pay', /оплат|зарплат|ожидан/i],
  ['citizen', /гражданств/i],
];

// city / pay / citizenship: values from the user's profile (local data); empty → «нужен твой ответ»
async function fromProfile(kind: StandardKind, block: HTMLElement): Promise<boolean> {
  const local = await localStore.loadIndexed().catch(() => null);
  const value = standardValue(kind, local?.data.profile ?? null, { title: vacancyTitle() });
  if (!value)
    return false;

  return typeOrClick(block, value, valueRe(value));
}

const FILL: Record<QuestionKind, (block: HTMLElement) => Promise<boolean>> = {
  city: block => fromProfile('city', block),
  pay: block => fromProfile('pay', block),
  ip: block => clickChoice(block, /^(да|yes)\b/i),
  open: block => clickChoice(block, /^(да|yes)\b/i),
  schedule: block => clickChoice(block, /удал|remote|дистанц|гибк/i),
  citizen: block => fromProfile('citizen', block),
};

type CloudQuestion = {
  context: string;
  prompt: string;
  kind: 'text' | 'number' | 'choice';
  options: string[];
};

type CloudAnswer = { answer?: string; human?: boolean; reason?: string; source?: string };

const CUSTOM_REASONS = ['свои вопросы площадки', 'свои вопросы HH'];
const FIELD_SEL = 'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])';

export async function fillApply(): Promise<FillFail | null> {
  const blocked = captchaFail();
  if (blocked)
    return blocked;

  const asked = employerQuestionnaire();
  if (asked)
    return { ok: false, status: 'needsHuman', reason: asked.reason, hints: asked.hints, ...(asked.form ? { form: asked.form } : {}) };

  const kind = resumeKind(vacancyTitle(), vacancyBody());
  noteLive(`apply-fill.ts · резюме ${kind}`);
  await pickResume(kind);

  if ((await coverLetter()).length === 0)
    return humanFail('нужен твой ответ: сопроводительное письмо не задано в профиле', []);

  const letterOk = await insertLetter();
  const mid = captchaFail();
  if (mid)
    return mid;

  if (letterOk === false)
    return { ok: false, status: 'skip', reason: 'нет поля сопроводительного' };

  return fillQuestions();
}

async function fillQuestions(): Promise<FillFail | null> {
  const answered: string[] = [];
  for (const row of promptFields()) {
    const blocked = captchaFail();
    if (blocked)
      return blocked;

    const kind = KIND_RE.find(([, re]) => re.test(row.prompt))?.[0];
    const known = kind !== undefined && isStandardQuestion(row.prompt);
    if (known) {
      const ok = await FILL[kind](row.root);
      if (ok === false) {
        const blocked = captchaFail();
        if (blocked)
          return blocked;

        return humanFail(`нужен твой ответ: ${row.prompt}`, [row.prompt]);
      }

      continue;
    }

    const fail = await fillByCloud(row.prompt, row.root);
    if (fail)
      return fail;

    answered.push(row.prompt);
  }

  const blocked = applyBlocker();
  if (blocked && coveredBy(blocked.reason, blocked.hints, answered) === false)
    return humanFail(blocked.reason, blocked.hints);

  return null;
}

function coveredBy(reason: string, hints: string[], answered: string[]): boolean {
  if (!CUSTOM_REASONS.includes(reason) || answered.length === 0)
    return false;

  const norm = (text: string) => compact(text).toLowerCase();
  const done = answered.map(norm);

  return hints.every((hint) => {
    const key = norm(hint);

    return done.some(item => item.includes(key) || key.includes(item));
  });
}

// selectors / dictionaries from the server config (last valid cached), built-in defaults until it loads
let remote = BUILTIN;
void cachedConfig({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>>, set: items => browser.storage.local.set(items) }).then((config) => { remote = config; }).catch(() => null);

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
function skillJunk(prompt: string): boolean {
  const words = remote.dictionaries.skillJunk ?? BUILTIN.dictionaries.skillJunk;

  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${words.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(prompt);
}

async function fillByCloud(prompt: string, block: HTMLElement): Promise<FillFail | null> {
  if (skillJunk(prompt))
    return { ok: false, status: 'skip', reason: `не наше: ${prompt}`, hints: [prompt] };

  const question = describeField(prompt, block);
  if (question === null)
    return humanFail(`поле не разобрал: ${prompt}`, [prompt]);

  // thin client: the server decides (rule → profile → human edit → memory → LLM); we only fill, never submit
  const reply = await ask<CloudAnswer>({ type: 'answer-question', ...question, vacancyTitle: vacancyTitle() });
  const answer = reply?.answer;
  if (typeof answer !== 'string' || answer.length === 0)
    return humanFail(`${prompt}: ${reply?.reason || 'нет ответа'}`, [prompt]);
  noteLive(`apply-fill.ts · сервер (${reply?.source ?? '?'}): ${prompt}`);

  const ok = question.kind === 'choice'
    ? clickChoice(block, exactRe(answer))
    : typeAnswer(block, answer);
  if (ok === false) {
    const blocked = captchaFail();
    if (blocked)
      return blocked;

    return humanFail(`не вставил ответ: ${prompt}`, [prompt]);
  }

  return null;
}

function describeField(prompt: string, block: HTMLElement): CloudQuestion | null {
  const context = compact(applyRoot()?.innerText || '').slice(0, 1500);
  const select = block.querySelector('select');
  if (select)
    return { context, prompt, kind: 'choice', options: [...select.options].map(item => compact(item.text)).filter(item => item.length > 0) };

  const choices = [...block.querySelectorAll<HTMLElement>('label, [role="radio"], [role="option"]')]
    .map(element => compact(element.textContent || ''))
    .filter(text => text.length > 0 && text.length < 80 && text !== compact(prompt));
  if (choices.length >= 2)
    return { context, prompt, kind: 'choice', options: [...new Set(choices)] };

  const field = block.querySelector<HTMLElement>(FIELD_SEL);
  if (field === null)
    return null;

  const numeric = field.getAttribute('type') === 'number' || /numeric|decimal/i.test(field.getAttribute('inputmode') || '');

  return { context, prompt, kind: numeric ? 'number' : 'text', options: [] };
}

function typeAnswer(block: HTMLElement, answer: string): boolean {
  if (captchaOnPage())
    return false;

  const field = block.querySelector<HTMLElement>(FIELD_SEL);
  if (field === null)
    return false;

  typeInto(field, answer, false);
  const value = field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement ? field.value : (field.textContent || '');

  return compact(value).includes(compact(answer).slice(0, 20));
}

function exactRe(text: string): RegExp {
  const escaped = compact(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`^${escaped}$`, 'i');
}

function humanFail(reason: string, hints: string[]): FillFail {
  return { ok: false, status: 'needsHuman', reason, hints };
}

function captchaFail(): FillFail | null {
  const captcha = captchaOnPage();
  if (captcha === null)
    return null;

  return { ok: false, status: 'needsHuman', reason: captcha.reason, hints: captcha.hints };
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
  if (letterField() || captchaOnPage())
    return;

  letterToggle()?.click();
  await until(() => letterField() !== null, 4000);
}

function letterField(): HTMLElement | null {
  const named = document.querySelector<HTMLElement>([selector(remote, 'letterField'), 'textarea[name*="letter"]'].join(','));
  if (named && visible(named))
    return named;

  return [...document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')]
    .find(element => visible(element) && isCoverLetter(element)) ?? null;
}

function letterToggle(): HTMLElement | null {
  const qa = document.querySelector<HTMLElement>(selector(remote, 'letterToggle'));
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
  if (captchaOnPage())
    return false;

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
  if (captchaOnPage())
    return false;

  const field = block.querySelector<HTMLElement>('textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"])');
  if (field === null)
    return false;

  typeInto(field, text, false);
  await pause(280, 1_100);
  const opt = [...document.querySelectorAll<HTMLElement>('[role="option"], [data-qa*="suggest"]')]
    .find(element => re.test(element.textContent || ''));
  opt?.click();

  return true;
}

export function asHumanBlock(fail: FillFail): ApplyBlock {
  return { reason: fail.reason, hints: fail.hints || [fail.reason] };
}

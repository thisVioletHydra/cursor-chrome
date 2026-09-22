import { applySucceeded, metaFrom } from './apply-watch';
import { compact, onVacancyPage, vacancyIdFromLocation, visible } from './dom';
import { formReady } from './apply-detect';
import { applyRoot } from './screen-questions';

const PAGE_QA = [
  '[data-qa="vacancy-response-link-top"]',
  '[data-qa="vacancy-response-link-bottom"]',
  '[data-qa="vacancy-response-link"]',
];

const APPLIED = /вы откликнулись|отклик отправлен|резюме доставлено/i;
const CHAT = /^(чат|chat)\b/i;
const SUBMIT = /откликнуться|отправить|готово/i;

export type OpenPlan =
  | { kind: 'ready' }
  | { kind: 'sent' }
  | { kind: 'skip'; reason: string }
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; el: HTMLElement };

export function pageSkip(): { ok: true; status: 'skip'; reason: string } | null {
  const reasons: Array<[boolean, string]> = [
    [onVacancyPage() === false && formReady() === false, 'не страница вакансии'],
    [ctaApplied(), 'уже откликались'],
  ];
  const hit = reasons.find(([on]) => on);
  if (hit === undefined)
    return null;

  return { ok: true, status: 'skip', reason: hit[1] };
}

export function planOpen(): OpenPlan {
  const early: OpenPlan[] = [
    formReady() ? { kind: 'ready' } : null,
    ctaApplied() ? { kind: 'sent' } : null,
  ].filter((row): row is OpenPlan => row !== null);
  if (early[0])
    return early[0];

  const el = findMainApply();
  if (el === null)
    return { kind: 'skip', reason: 'нет кнопки Откликнуться' };

  const url = responseHref(el);
  if (url)
    return { kind: 'navigate', url };

  return { kind: 'click', el };
}

export function ctaApplied(): boolean {
  const el = mainAction();
  const text = compact(el?.textContent || '').toLowerCase();
  if (text.length === 0)
    return false;

  return APPLIED.test(text) || CHAT.test(text);
}

export function freshSuccess(hadToast: boolean): boolean {
  return ctaApplied() || (applySucceeded() && hadToast === false);
}

export function findSubmit(): HTMLElement | null {
  const roots = [applyRoot(), document.body].filter((el): el is HTMLElement => el !== null);

  for (const root of roots) {
    const qa = root.querySelector<HTMLElement>([
      '[data-qa="vacancy-response-submit-popup"]',
      '[data-qa="vacancy-response-submit"]',
      '[data-qa*="response-submit"]',
    ].join(','));
    if (qa && visible(qa))
      return qa;

    const byText = [...root.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')]
      .find(el => visible(el) && SUBMIT.test(submitLabel(el)) && /перейти/i.test(submitLabel(el)) === false);
    if (byText)
      return byText;
  }

  return null;
}

export function formErrors(): string[] {
  const root = applyRoot();
  if (root === null)
    return [];

  return [...root.querySelectorAll<HTMLElement>('[class*="error"], [data-qa*="error"], [aria-invalid="true"]')]
    .map(el => compact(el.textContent || ''))
    .filter(text => text.length > 2 && text.length < 200);
}

function findMainApply(): HTMLElement | null {
  const byQa = PAGE_QA
    .map(sel => document.querySelector<HTMLElement>(sel))
    .find(el => el !== null && visible(el) && isRelated(el) === false);
  if (byQa)
    return byQa;

  return [...document.querySelectorAll<HTMLElement>('button, a, [role="button"]')]
    .find(el => visible(el) && isApplyText(el) && isRelated(el) === false) ?? null;
}

function mainAction(): HTMLElement | null {
  return PAGE_QA
    .map(sel => document.querySelector<HTMLElement>(sel))
    .find(el => el !== null && visible(el)) ?? findMainApply();
}

function isApplyText(el: HTMLElement): boolean {
  return compact(el.textContent || '').toLowerCase().startsWith('откликнуться');
}

function isRelated(start: HTMLElement): boolean {
  const pageId = vacancyIdFromLocation();
  const meta = metaFrom(start);

  return pageId.length > 0 && meta.vacancyId.length > 0 && meta.vacancyId !== pageId;
}

function responseHref(el: HTMLElement): string | null {
  const link = el instanceof HTMLAnchorElement ? el : el.closest('a');
  const href = link?.href || '';
  if (/vacancy_response/i.test(href) === false)
    return null;

  return href;
}

function submitLabel(el: HTMLElement): string {
  const value = el instanceof HTMLInputElement ? el.value : '';

  return compact(`${el.textContent || ''} ${value}`);
}

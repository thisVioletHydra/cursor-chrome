import { ask } from './bridge';
import { applyMeta } from './apply-watch';
import { refreshOverlay } from './overlay';

const APPLY_SEL = [
  '[role="dialog"]',
  '[data-qa="vacancy-response-popup"]',
  '[data-qa*="response-popup"]',
  '[data-qa*="vacancy-response"]',
].join(',');

const APPLY_COPY = /ответьте на вопросы|сопроводительн|отклик на вакансию|vacancy-response/i;
const SKIP_PROMPT = /персональн|соглас|резюме|сопроводительн|письмо работодателю|выберите резюме|прикрепить|добавить файл|закрыть|отмена|контакты|ответьте на вопросы|дополнительные вопросы/i;
const SUBMIT = /откликнуться|отправить|готово/i;

const CUSTOM_MARK = /крипт|usdt|btc|игр[аыуе]|портфолио|тест|задач|почему\s+вы|расскажите|github|кейс|пазл|quiz|код[ауе]?\b/i;
const STANDARD = [
  /где.{0,32}(работ|жив)/i,
  /локаци/i,
  /\bгород/i,
  /график/i,
  /вакансия\s+открыт/i,
  /как\s+(с\s+вами\s+)?связат/i,
  /способ\s+связи/i,
  /гражданств/i,
  /ип|самозанят|\bгпх\b|контрагент/i,
];

const handed = new Set<string>();
let thisIsWorker = false;
let inflight = false;
let applyLock = false;

export function setApplyLock(on: boolean): void {
  applyLock = on;
}

export function markReviewing(): void {
  const meta = applyMeta();
  handed.add(meta.vacancyId || reviewUrl(meta));
}

export function watchScreenQuestions(): void {
  document.addEventListener('click', onSubmitAttempt, true);
  document.addEventListener('submit', onSubmitAttempt, true);
  const obs = new MutationObserver(() => void maybeHandoff());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  void refreshWorkerFlag();
}

export function scanScreenQuestions(): void {
  void refreshWorkerFlag();
  void maybeHandoff();
}

export function customQuestions(): string[] {
  const root = applyRoot();
  if (root === null)
    return [];

  return unique(collectPrompts(root).filter(text => isStandardQuestion(text) === false));
}

export type PromptField = { prompt: string; root: HTMLElement };

export function promptFields(): PromptField[] {
  const root = applyRoot();
  if (root === null)
    return [];

  return fieldItems(root)
    .map(item => ({ prompt: promptText(item).replace(/\s+/g, ' ').trim(), root: item }))
    .filter(row => row.prompt.length >= 8 && SKIP_PROMPT.test(row.prompt) === false);
}

export function applyRoot(): HTMLElement | null {
  const scoped = [...document.querySelectorAll<HTMLElement>(APPLY_SEL)]
    .find(element => visible(element) && APPLY_COPY.test(element.textContent || ''));
  if (scoped)
    return scoped;

  if (/\/applicant\/vacancy_response/i.test(location.pathname) === false)
    return null;

  const main = document.querySelector<HTMLElement>('main, [data-qa="vacancy-response-view"], form');

  return main && visible(main) ? main : document.body;
}

function collectPrompts(root: HTMLElement): string[] {
  const nodes = [
    ...root.querySelectorAll<HTMLElement>('label, legend, [data-qa*="question"], [class*="question"], .bloko-form-label, [class*="FormLabel"], [class*="form-label"]'),
    ...fieldItems(root),
  ];

  return nodes
    .map(promptText)
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 8 && text.length < 400)
    .filter(text => SKIP_PROMPT.test(text) === false);
}

function fieldItems(root: HTMLElement): HTMLElement[] {
  const fields = [...root.querySelectorAll<HTMLElement>('textarea, input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="submit"]), select')];

  return fields.flatMap((field) => {
    if (isCoverLetter(field))
      return [];

    const item = field.closest<HTMLElement>('.bloko-form-item, [class*="form-item"], [data-qa*="question"], fieldset');

    return item ? [item] : [];
  });
}

export function isCoverLetter(field: HTMLElement): boolean {
  const qa = `${field.getAttribute('data-qa') || ''} ${field.id} ${field.getAttribute('name') || ''}`;
  if (/letter|сопровод/i.test(qa))
    return true;

  const ph = field.getAttribute('placeholder') || '';

  return /сопровод|письмо/i.test(ph);
}

function promptText(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label') || '';
  if (aria.length >= 8)
    return aria;

  const clone = element.cloneNode(true) as HTMLElement;
  for (const nested of clone.querySelectorAll('textarea, input, select, button, a, svg'))
    nested.remove();

  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

export function isStandardQuestion(text: string): boolean {
  if (CUSTOM_MARK.test(text))
    return false;

  return STANDARD.some(re => re.test(text)) || isMarketPay(text);
}

function isMarketPay(text: string): boolean {
  if (/оплат|зарплат/.test(text) === false || /крипт|usdt|формат/.test(text))
    return false;

  return text.length < 64 || /рынк/.test(text);
}

function onSubmitAttempt(event: Event): void {
  if (applyLock || thisIsWorker === false || reviewHints().length === 0)
    return;

  if (isSubmitTarget(event) === false)
    return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void maybeHandoff();
}

function isSubmitTarget(event: Event): boolean {
  if (event.type === 'submit')
    return true;

  const hit = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement);
  const btn = hit?.closest('button, [role="button"], input[type="submit"]') ?? null;
  if (hit === undefined || btn === null)
    return false;

  const value = btn instanceof HTMLInputElement ? btn.value : '';
  const text = `${btn.textContent || ''} ${value}`.replace(/\s+/g, ' ').trim();

  return SUBMIT.test(text);
}

function shouldSkipHandoff(hints: string[], key: string): boolean {
  const locked = applyLock || inflight;
  const empty = hints.length === 0 || handed.has(key);

  return locked || empty || thisIsWorker === false;
}

async function maybeHandoff(): Promise<void> {
  const hints = reviewHints();
  const meta = applyMeta();
  const url = reviewUrl(meta);
  const key = meta.vacancyId || url;
  if (shouldSkipHandoff(hints, key))
    return;

  inflight = true;
  handed.add(key);
  const res = await ask<{ role?: string }>({
    type: 'apply-needs-human',
    ...meta,
    url,
    hints: hints.slice(0, 8),
  });
  if (res === null)
    handed.delete(key);
  else if (res.role === 'review')
    thisIsWorker = false;

  inflight = false;
  await refreshOverlay();
}

export function reviewHints(): string[] {
  const custom = customQuestions();
  if (custom.length > 0)
    return custom;

  if (onVacancy()) {
    const offsite = offsiteHints();
    if (offsite.length > 0)
      return offsite;
  }

  return unlabeledHints();
}

function offsiteHints(): string[] {
  const hrefs = [...document.querySelectorAll('iframe[src], a[href]')]
    .map(element => element.getAttribute('src') || (element as HTMLAnchorElement).href || '')
    .join('\n');
  if (/docs\.google\.com\/forms|forms\.gle\/|typeform\.com|tally\.so/i.test(hrefs))
    return ['гугл-форма / тест'];

  const test = [...document.querySelectorAll('a, button')].some((element) => {
    return /пройти\s+(тест|задани)/i.test((element.textContent || '').replace(/\s+/g, ' '));
  });

  return test ? ['гугл-форма / тест'] : [];
}

function unlabeledHints(): string[] {
  const root = applyRoot();
  if (root === null)
    return [];

  const extras = fieldItems(root).filter(item => promptText(item).length < 8);

  return extras.length > 0 ? ['неподписанные вопросы'] : [];
}

function onVacancy(): boolean {
  return /\/vacancy\/\d+|vacancy_response/i.test(location.pathname);
}

function reviewUrl(meta: { url: string }): string {
  if (/vacancy_response/i.test(location.pathname))
    return location.href;

  if (meta.url.length > 0)
    return meta.url;

  return location.href.split('?')[0] || location.href;
}

async function refreshWorkerFlag(): Promise<void> {
  const res = await ask<{ worker?: boolean }>({ type: 'is-hh-worker' });
  thisIsWorker = res?.worker === true;
}

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

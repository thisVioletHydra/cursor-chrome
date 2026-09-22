import type { ApplyPayload } from './bridge';

import { isJunkApply } from '../chrome/apply-log';
import { ancestors, ask } from './bridge';
import { refreshOverlay } from './overlay';

const SUCCESS = /резюме доставлено|вы откликнулись|отклик отправлен/i;

const seenChat = new WeakSet<Element>();
const seenAtStart = new WeakSet<Element>();
let chatsPrimed = false;
let pendingApply: ApplyPayload | null = null;

export function watchToasts(): void {
  document.addEventListener('click', rememberApplyClick, true);
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node instanceof Element && toastHit(node))
          void logSuccess(node);
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

export function scanApplied(): void {
  const buttons = chatButtons();
  if (chatsPrimed === false) {
    for (const btn of buttons) {
      seenAtStart.add(btn);
      if (hasFreshMark(btn) === false)
        continue;

      seenChat.add(btn);
      void sendLog(metaFrom(btn));
    }

    chatsPrimed = true;

    return;
  }

  for (const btn of buttons) {
    if (seenChat.has(btn))
      continue;

    if (seenAtStart.has(btn) && hasFreshMark(btn) === false)
      continue;

    seenChat.add(btn);
    void sendLog(metaFrom(btn));
  }
}

function rememberApplyClick(event: Event): void {
  const hit = event.composedPath().find((node): node is HTMLElement =>
    node instanceof HTMLElement && isApplyTrigger(node));
  if (hit === undefined)
    return;

  const meta = metaFrom(hit);
  if (meta.vacancyId.length > 0)
    pendingApply = meta;
}

function isApplyTrigger(node: HTMLElement): boolean {
  if (node.matches('button, a, [role="button"]') === false)
    return false;

  const text = (node.textContent || '').replace(/\s+/g, ' ').trim();

  return text.toLowerCase().startsWith('откликнуться');
}

function toastHit(root: Element): boolean {
  const nodes = [root, ...root.querySelectorAll('*')];

  return nodes.some((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (SUCCESS.test(text) === false)
      return false;

    const qa = `${element.getAttribute('data-qa') || ''} ${element.className}`;
    const role = element.getAttribute('role') || '';

    return /response|notification|snackbar|modal|popup|alert/i.test(qa)
      || role === 'alert'
      || role === 'dialog'
      || role === 'status'
      || text.length < 80;
  });
}

function chatButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll('button')).filter((btn) => {
    const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();

    return text === 'Чат' || text.startsWith('Чат ');
  });
}

function hasFreshMark(start: HTMLElement): boolean {
  const card = cardFrom(start);
  if (card === null)
    return false;

  for (const element of card.querySelectorAll('*')) {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > 48)
      continue;

    if (/ваша активность/i.test(text))
      return true;
  }

  return false;
}

async function logSuccess(origin?: Element): Promise<void> {
  const fromPending = pendingApply;
  const fromModal = vacancyFromModal();
  const fromToast = origin instanceof HTMLElement ? metaFrom(origin) : emptyPayload();
  const fromPage = vacancyMeta();
  const payload = pickPayload(fromPending, fromModal, fromToast, fromPage);
  await sendLog(payload);
  pendingApply = null;
}

function pickPayload(...rows: Array<ApplyPayload | null>): ApplyPayload {
  return rows.find(row => row !== null && row.vacancyId.length > 0) || emptyPayload();
}

export function applySucceeded(): boolean {
  const nodes = document.querySelectorAll('[role="alert"], [role="status"], [role="dialog"], [data-qa*="notification"], [class*="snackbar"]');

  return [...nodes].some((element) => {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();

    return SUCCESS.test(text) && text.length < 80;
  });
}

export function applyMeta(): ApplyPayload {
  return pickPayload(pendingApply, vacancyFromModal(), vacancyMeta());
}

async function sendLog(payload: ApplyPayload): Promise<void> {
  if (payload.title.length === 0 && payload.company.length === 0 && payload.vacancyId.length === 0)
    return;

  if ((payload.title.length > 0 || payload.company.length > 0)
    && isJunkApply({
      title: payload.title.length > 0 ? payload.title : 'ok',
      company: payload.company,
    }))
    return;

  if (payload.vacancyId.length === 0 && /\/vacancy\/\d+/.test(payload.url) === false)
    return;

  await ask({ type: 'apply-log', ...payload });
  await refreshOverlay();
}

function vacancyFromModal(): ApplyPayload | null {
  const modal = document.querySelector<HTMLElement>([
    '[role="dialog"]',
    '[data-qa="vacancy-response-popup"]',
    '[data-qa*="response-popup"]',
    '[data-qa*="vacancy-response"]',
  ].join(','));
  if (modal === null)
    return null;

  const meta = metaFrom(modal);
  if (meta.vacancyId.length > 0)
    return meta;

  return null;
}

function vacancyMeta(): ApplyPayload {
  const parsed = new URL(location.href);
  const vacancyId = parsed.pathname.match(/\/vacancy\/(\d+)/)?.[1]
    || parsed.searchParams.get('vacancyId')
    || '';
  if (vacancyId.length === 0)
    return emptyPayload();

  const onResponse = /vacancy_response/i.test(parsed.pathname);
  const title = pickVacancyTitle();
  const company = textOf([
    '[data-qa="vacancy-company-name"]',
    '[data-qa="vacancy-company-name"] a',
    '[data-qa="employer"]',
  ]);
  const url = onResponse ? location.href : `${parsed.origin}/vacancy/${vacancyId}`;
  if ((title.length > 0 && isJunkApply({ title, company: '' }))
    || (company.length > 0 && isJunkApply({ title: 'ok', company })))
    return { title: '', company: '', url, vacancyId };

  return { title, company, url, vacancyId };
}

function pickVacancyTitle(): string {
  for (const selector of ['[data-qa="vacancy-title"]', 'h1[data-qa="title"]', 'h1']) {
    const hit = document.querySelector(selector)?.textContent?.trim() || '';
    if (hit.length === 0 || isJunkApply({ title: hit, company: '' }))
      continue;

    return hit;
  }

  return '';
}

function emptyPayload(): ApplyPayload {
  return { title: '', company: '', url: location.href, vacancyId: '' };
}

export function metaFrom(start: HTMLElement): ApplyPayload {
  const card = cardFrom(start);
  if (card === null)
    return emptyPayload();

  const link = vacancyTitleLinks(card)[0];
  if (link === undefined)
    return emptyPayload();

  const vacancyId = link.href.match(/\/vacancy\/(\d+)/)?.[1] || '';
  const title = (link.textContent || '').trim();
  const company = Array.from(card.querySelectorAll('a'))
    .map(item => (item.textContent || '').trim())
    .find(text => text.length > 1 && text !== title && isJunkApply({ title: 'ok', company: text }) === false)
    || '';
  const url = link.href.split('?')[0];
  if ((title.length > 0 && isJunkApply({ title, company: '' }))
    || (company.length > 0 && isJunkApply({ title: 'ok', company })))
    return { title: '', company: '', url, vacancyId };

  return { title, company, url, vacancyId };
}

function cardFrom(start: HTMLElement): HTMLElement | null {
  let card: HTMLElement | null = null;
  for (const node of ancestors(start, 12)) {
    const links = vacancyTitleLinks(node);
    if (links.length > 1)
      break;

    if (links.length === 1)
      card = node;
  }

  return card;
}

function vacancyTitleLinks(root: HTMLElement): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/vacancy/"]'))
    .filter((item) => {
      const id = item.href.match(/\/vacancy\/(\d+)/)?.[1];
      const title = (item.textContent || '').trim();
      if (!id || title.length <= 5)
        return false;

      return isJunkApply({ title, company: '' }) === false;
    });
}

function textOf(selectors: string[]): string {
  for (const selector of selectors) {
    const hit = document.querySelector(selector)?.textContent?.trim();
    if (hit)
      return hit;
  }

  return '';
}

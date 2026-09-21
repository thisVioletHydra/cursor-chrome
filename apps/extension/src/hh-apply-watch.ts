import type { ApplyPayload } from './hh-bridge';

import { ask } from './hh-bridge';
import { refreshOverlay } from './hh-overlay';

const SUCCESS = /резюме доставлено|вы откликнулись|отклик отправлен/i;

const seenChat = new WeakSet<Element>();
let chatsPrimed = false;

export function watchToasts(): void {
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
      seenChat.add(btn);
      if (hasFreshMark(btn))
        void sendLog(metaFrom(btn));
    }

    chatsPrimed = true;

    return;
  }

  for (const btn of buttons) {
    if (seenChat.has(btn))
      continue;

    seenChat.add(btn);
    void sendLog(metaFrom(btn));
  }
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
  let node: HTMLElement | null = start;
  for (let index = 0; index < 10 && node; index++) {
    const text = node.innerText || '';
    if (text.length > 2000)
      return false;

    if (/ваша активность/i.test(text))
      return true;

    node = node.parentElement;
  }

  return false;
}

async function logSuccess(origin?: Element): Promise<void> {
  const fromToast = origin instanceof HTMLElement ? metaFrom(origin) : vacancyMeta();
  const payload = fromToast.vacancyId ? fromToast : vacancyMeta();
  await sendLog(payload);
}

async function sendLog(payload: ApplyPayload): Promise<void> {
  if (payload.vacancyId.length === 0 && /\/vacancy\/\d+/.test(payload.url) === false)
    return;

  await ask({ type: 'apply-log', ...payload });
  await refreshOverlay();
}

function vacancyMeta(): ApplyPayload {
  const url = location.href;
  const vacancyId = url.match(/\/vacancy\/(\d+)/)?.[1] || '';
  if (vacancyId) {
    return {
      title: textOf(['[data-qa="vacancy-title"]', 'h1[data-qa="title"]', 'h1']),
      company: textOf(['[data-qa="vacancy-company-name"]', '[data-qa="vacancy-company-name"] a', '[data-qa="employer"]']),
      url: url.split('?')[0],
      vacancyId,
    };
  }

  const chats = chatButtons();
  const fresh = [...chats].reverse().find(hasFreshMark) || chats.at(-1);

  return fresh ? metaFrom(fresh) : { title: '', company: '', url, vacancyId: '' };
}

function metaFrom(start: HTMLElement): ApplyPayload {
  let node: HTMLElement | null = start;
  let card: HTMLElement | null = null;
  for (let index = 0; index < 12 && node; index++) {
    const links = vacancyTitleLinks(node);
    if (links.length > 1)
      break;

    if (links.length === 1)
      card = node;

    node = node.parentElement;
  }

  const link = card === null ? undefined : vacancyTitleLinks(card)[0];
  if (link === undefined || card === null)
    return { title: '', company: '', url: location.href, vacancyId: '' };

  const vacancyId = link.href.match(/\/vacancy\/(\d+)/)?.[1] || '';
  const title = (link.textContent || '').trim();
  const company = Array.from(card.querySelectorAll('a'))
    .map(item => (item.textContent || '').trim())
    .find(text => text.length > 1 && text !== title)
    || '';

  return { title, company, url: link.href.split('?')[0], vacancyId };
}

function vacancyTitleLinks(root: HTMLElement): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/vacancy/"]'))
    .filter((item) => {
      const id = item.href.match(/\/vacancy\/(\d+)/)?.[1];
      const title = (item.textContent || '').trim();

      return Boolean(id) && title.length > 5;
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

import { tellPage, whileSearching } from './page-log';
import { isHhUrl, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

const LOOK = 40;
const PAGE_MS = 45_000;
const SEARCH = 'https://hh.ru/search/vacancy';
const HH_ROOT = 'https://hh.ru/';

export type SearchHit = {
  login: boolean;
  cards: FoundCard[];
  reason: string;
};

export type FoundCard = {
  id: string;
  title: string;
  company: string;
  url: string;
  text: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  currency: string;
  remote: boolean;
  experience: string;
};

export async function collectVacancies(queries: string[], seenIds: readonly string[] = []): Promise<SearchHit> {
  const tabId = await searchTab();
  if (tabId === null)
    return { login: false, cards: [], reason: 'нет запиненной вкладки hh' };

  const here = await browser.tabs.get(tabId).catch(() => null);
  if (here !== null && isLogin(here.url || '', ''))
    return { login: true, cards: [], reason: '' };

  const cards: FoundCard[] = [];
  const seen = new Set<string>();
  const known = new Set(seenIds.filter(id => /^\d+$/.test(id)));
  let knownHits = 0;
  let sawCards = false;
  let unread = false;
  const login = await whileSearching(async () => {
    for (const query of queries) {
      if (cards.length >= LOOK)
        return false;

      for (const page of [0, 1]) {
        if (cards.length >= LOOK)
          return false;

        const pulled = await pull(tabId, searchUrl(query, page));
        if (pulled === null) {
          if (cards.length === 0 && knownHits === 0) {
            unread = true;

            return false;
          }

          break;
        }

        if (isLogin(pulled.url, pulled.html))
          return true;

        const batch = cardsOf(serpHtml(pulled.html));
        if (batch.length === 0)
          break;

        sawCards = true;
        for (const card of batch) {
          if (cards.length >= LOOK || fitsTitle(card.title, queries) === false)
            continue;

          if (seen.has(card.id))
            continue;

          seen.add(card.id);
          if (known.has(card.id)) {
            knownHits += 1;
            continue;
          }

          cards.push(card);
        }

        await pause(1500, 4000);
      }
    }

    return false;
  });

  if (login)
    return { login: true, cards, reason: '' };

  if (unread) {
    await tellPage('не прочиталась страница hh');

    return { login: false, cards, reason: 'не прочиталась страница hh' };
  }

  if (cards.length === 0 && knownHits > 0) {
    await tellPage(`уже видели, ${knownHits}`);

    return { login: false, cards, reason: `уже видели, ${knownHits}` };
  }

  if (cards.length === 0)
    return { login: false, cards, reason: sawCards ? 'нет вакансий по запросу' : 'пустая выдача' };

  for (const card of cards) {
    await tellPage(`открыл ${cardTitle(card)}`);
    const pulled = await pull(tabId, card.url);
    if (pulled !== null && isLogin(pulled.url, pulled.html))
      return { login: true, cards, reason: '' };

    if (pulled !== null)
      fillText(card, pulled.html);

    await pause(400, 1200);
  }

  return { login: false, cards, reason: '' };
}

function cardTitle(card: FoundCard): string {
  const title = card.title.trim();
  if (title.length > 0)
    return title;

  return card.id;
}

function searchUrl(query: string, page: number): string {
  const url = new URL(SEARCH);
  url.searchParams.set('text', query);
  url.searchParams.set('search_period', '3');
  url.searchParams.set('order_by', 'publication_time');
  url.searchParams.set('page', String(page));

  return url.toString();
}

async function searchTab(): Promise<number | null> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await requireWorkerTab();
  }
  catch {
    return null;
  }

  if (typeof tab.id !== 'number')
    return null;

  const url = tab.url || tab.pendingUrl || '';
  if (isHhUrl(url) === false)
    return null;

  if (onHhRoot(url))
    return tab.id;

  await showUrl(tab.id, HH_ROOT);

  return tab.id;
}

function onHhRoot(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'hh.ru';
  }
  catch {
    return false;
  }
}

// Service worker fetch не видит сессию вкладки. Запрос делает сама страница hh.ru.
async function pull(tabId: number, url: string): Promise<{ url: string; html: string } | null> {
  const fetched = await fetchInPage(tabId, url);
  if (usable(fetched))
    return fetched;

  await showUrl(tabId, url);

  return readTab(tabId);
}

function usable(page: { url: string; html: string; ok: boolean } | null): page is { url: string; html: string; ok: boolean } {
  if (page === null)
    return false;

  if (isLogin(page.url, page.html))
    return true;

  return page.ok && page.html.length > 0 && isGuard(page.html) === false;
}

async function fetchInPage(tabId: number, url: string): Promise<{ url: string; html: string; ok: boolean } | null> {
  try {
    const results = await within(browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fetchPage,
      args: [url, PAGE_MS],
    }), PAGE_MS + 5_000);
    if (results === null)
      return null;

    return asFetched(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function readTab(tabId: number): Promise<{ url: string; html: string } | null> {
  try {
    const results = await within(browser.scripting.executeScript({
      target: { tabId },
      func: readPage,
    }), PAGE_MS);
    if (results === null)
      return null;

    return asHtml(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function showUrl(tabId: number, url: string): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const loaded = waitTab(tabId, 15_000);
  await within(browser.tabs.update(tabId, tab?.active === true ? { url } : { url, active: false }), PAGE_MS);
  await loaded;
  await pause(500, 1200);
}

function fetchPage(url: string, ms: number): Promise<{ url: string; html: string; ok: boolean }> {
  return fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(ms),
  }).then(res => res.text().then(html => ({
    url: res.url,
    html: html.slice(0, 1_500_000),
    ok: res.ok,
  }))).catch(() => ({ url, html: '', ok: false }));
}

function readPage(): { url: string; html: string } {
  const root = document.documentElement;

  return {
    url: location.href,
    html: root ? root.outerHTML.slice(0, 1_500_000) : '',
  };
}

function asFetched(raw: unknown): { url: string; html: string; ok: boolean } | null {
  const page = asHtml(raw);
  if (page === null || typeof raw !== 'object' || raw === null || 'ok' in raw === false)
    return null;

  if (typeof raw.ok !== 'boolean')
    return null;

  return { url: page.url, html: page.html, ok: raw.ok };
}

function asHtml(raw: unknown): { url: string; html: string } | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const html = 'html' in raw ? raw.html : undefined;
  const url = 'url' in raw ? raw.url : undefined;
  if (typeof html !== 'string' || typeof url !== 'string' || html.length === 0)
    return null;

  return { url, html };
}

function isGuard(html: string): boolean {
  return html.includes('ddos-guard') || html.includes('__ddgfp') || html.includes('cf-browser-verification');
}

function isLogin(url: string, html: string): boolean {
  return url.includes('/account/login') || html.includes('data-qa="account-login"');
}

const SIDE = [
  'Вам подойдут',
  'Подходящие вакансии',
  'Вакансии для вас',
  'Также смотрят',
  'Похожие вакансии',
  'Рекомендуемые вакансии',
];

const TITLE_WORD: Record<string, string[]> = {
  frontend: ['frontend', 'фронтенд', 'фронтэнд'],
  vuejs: ['vue'],
  typescript: ['typescript'],
  javascript: ['javascript'],
  nodejs: ['nodejs', 'node'],
  fullstack: ['fullstack', 'фулстек', 'фуллстек', 'фулстэк'],
  nestjs: ['nestjs'],
  graphql: ['graphql'],
};

function serpHtml(html: string): string {
  const firstCard = html.indexOf('data-qa="vacancy-serp__vacancy"');
  if (firstCard < 0)
    return html;

  let cut = html.length;
  for (const label of SIDE) {
    const at = html.indexOf(label, firstCard);
    if (at >= 0 && at < cut)
      cut = at;
  }

  return html.slice(0, cut);
}

function fitsTitle(title: string, queries: string[]): boolean {
  const hay = fold(title);

  return queries.some(query => queryFits(hay, query));
}

function queryFits(hay: string, query: string): boolean {
  const glued = fold(query).replace(/ /g, '');
  if (glued.length === 0)
    return false;

  const needles = TITLE_WORD[glued] ?? [glued];

  return needles.some(needle => hasWord(hay, needle));
}

function hasWord(hay: string, needle: string): boolean {
  if (bounded(hay, needle))
    return true;

  const gluedNeedle = needle.replace(/ /g, '');
  if (gluedNeedle.length < 4)
    return false;

  return hay.replace(/ /g, '').includes(gluedNeedle);
}

function bounded(hay: string, needle: string): boolean {
  if (needle.length === 0)
    return false;

  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(needle)}`, 'iu').test(hay);
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.\-_/+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cardsOf(html: string): FoundCard[] {
  const chunks = html.split('data-qa="vacancy-serp__vacancy"').slice(1);
  const cards: FoundCard[] = [];
  for (const chunk of chunks) {
    const card = cardOf(chunk);
    if (card !== null)
      cards.push(card);
  }

  return cards;
}

function cardOf(chunk: string): FoundCard | null {
  const id = chunk.match(/\/vacancy\/(\d+)/)?.[1] ?? '';
  const title = textAt(chunk, 'serp-item__title');
  if (id.length === 0 || title.length === 0)
    return null;

  const company = textAt(chunk, 'vacancy-serp__vacancy-employer');
  const place = textAt(chunk, 'vacancy-serp__vacancy-address');
  const pay = salaryOf(textAt(chunk, 'vacancy-serp__vacancy-compensation'));
  const snippet = decode(chunk.slice(0, 4000)).slice(0, 500);

  return {
    id,
    title,
    company: company.length > 0 ? company : 'без компании',
    url: `https://hh.ru/vacancy/${id}`,
    text: snippet.length > 0 ? snippet : title,
    salaryFrom: pay.from,
    salaryTo: pay.to,
    currency: pay.currency,
    remote: /удал[её]н|remote/i.test(`${place} ${snippet}`),
    experience: '',
  };
}

function fillText(card: FoundCard, html: string): void {
  const at = html.indexOf('data-qa="vacancy-description"');
  const text = at < 0 ? '' : decode(html.slice(at, at + 20_000)).slice(0, 6000);
  if (text.length > 0)
    card.text = text;

  const experience = textAt(html, 'vacancy-experience');
  if (experience.length > 0)
    card.experience = experience.slice(0, 80);
}

function textAt(html: string, qa: string): string {
  const at = html.indexOf(`data-qa="${qa}"`);
  if (at < 0)
    return '';

  const block = html.slice(at, at + 800);
  const close = block.indexOf('>');
  if (close < 0)
    return '';

  const rest = block.slice(close + 1);
  const end = rest.search(/<\/(a|span|div|h\d)/i);

  return decode(end < 0 ? rest : rest.slice(0, end));
}

function currencyOf(text: string): string {
  if (/₽|руб/i.test(text))
    return 'RUR';

  if (/\$|USD/i.test(text))
    return 'USD';

  if (/€|EUR/i.test(text))
    return 'EUR';

  return '';
}

function salaryOf(text: string): { from: number | null; to: number | null; currency: string } {
  const currency = currencyOf(text);
  const numbers = [...text.replace(/\s/g, '').matchAll(/\d+/g)].map(item => Number(item[0]));
  const fromTo = text.includes('от') && text.includes('до');
  if (fromTo && numbers.length >= 2)
    return { from: numbers[0], to: numbers[1], currency };

  if (text.includes('от') && numbers.length > 0)
    return { from: numbers[0], to: null, currency };

  if (text.includes('до') && numbers.length > 0)
    return { from: null, to: numbers[0], currency };

  if (numbers.length >= 2)
    return { from: numbers[0], to: numbers[1], currency };

  if (numbers.length === 1)
    return { from: numbers[0], to: null, currency };

  return { from: null, to: null, currency };
}

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function pause(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min));

  return new Promise(resolve => setTimeout(resolve, ms));
}

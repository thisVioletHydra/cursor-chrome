import { getFlags } from '../pilot/flags';
import { freshPilot, pilotStep } from '../chrome/pilot';
import { tabShowsCaptcha } from '../tab/hh-captcha';
import { hangHalted, loadWithin, tellPage, whileSearching } from '../pilot/page-log';
import { PAGE_LOAD_MS, flipWaitMs, pageLoadMiss, searchStep } from './page-load';
import { getWorkerTabId, isBotWorkUrl, isHhUrl, openBotSearch, requireWorkerTab, wakeWorkerTab, waitTab } from '../tab/worker-tab';
import { browser } from '../browser-host';

const FIRST_PAGE = 0;
const endedQuery = new Set<string>();
let saidEnded = false;
let sawCaptcha = false;
const SEARCH = 'https://hh.ru/search/vacancy';
const HH_ROOT = 'https://hh.ru/';

export type SearchHit = {
  login: boolean;
  captcha: boolean;
  saved: number;
  more: boolean;
  done: boolean;
  reason: string;
};

export type PageLink = { id: string; url: string; title: string };

export type SearchCursor = { query: string; page: number };

export type PageMarks = {
  seen: ReadonlySet<string>;
  saved: readonly string[];
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
  query: string;
};

export async function collectVacancies(
  queries: string[],
  pages: Readonly<Record<string, number>>,
  knownOnPage: (ids: readonly string[], links: readonly PageLink[], cursor: SearchCursor) => Promise<PageMarks | null>,
  rememberPage: (cursor: SearchCursor) => Promise<boolean>,
): Promise<SearchHit> {
  sawCaptcha = false;
  endedQuery.clear();
  saidEnded = false;
  const pinned = await getWorkerTabId();
  if (pinned !== null && await tabShowsCaptcha(pinned))
    return miss(true, false, '');

  const tabId = await searchTab(queries);
  if (sawCaptcha)
    return miss(true, false, '');

  if (tabId === null) {
    await tellPage('нет запиненной вкладки hh');

    return miss(false, false, 'нет запиненной вкладки hh');
  }

  const here = await browser.tabs.get(tabId).catch(() => null);
  if (here !== null && isLogin(here.url || '', ''))
    return { login: true, captcha: false, saved: 0, more: false, done: false, reason: '' };

  let saved = 0;
  let missed = false;
  let done = true;
  let checkFailed = false;
  const login = await whileSearching(async () => {
    async function keep(query: string, next: number): Promise<boolean> {
      if (await rememberPage({ query, page: next }))
        return true;

      checkFailed = true;
      done = false;

      return false;
    }

    async function harvest(query: string, page: number, hold: number | null): Promise<PageHit> {
      const pulled = await pull(tabId, searchUrl(query, page));
      if (sawCaptcha)
        return 'fail';

      if (pulled === null) {
        if (hangHalted() || sawCaptcha)
          return 'fail';

        await noteMiss();

        return 'miss';
      }

      if (isLogin(pulled.url, pulled.html))
        return 'login';

      if (landedEarlier(pulled.url, page))
        return 'end';

      const batch = cardsOf(serpHtml(pulled.html));
      const more = pulled.html.includes('data-qa="pager-next"');
      if (batch.length === 0)
        return searchStep({ saved: 0, hasNext: more });

      const fitting = batch.filter(card => fitsTitle(card.title, queries));
      const marks = await knownOnPage(
        batch.map(card => card.id),
        fitting.map(card => ({ id: card.id, url: card.url, title: card.title })),
        { query, page: heldPage(hold, page, more) },
      );
      if (marks === null) {
        checkFailed = true;
        done = false;

        return 'fail';
      }

      if (batch.every(card => marks.seen.has(card.id)))
        await tellPage(`уже видели, ${batch.length}`);

      const step = searchStep({ saved: marks.saved.length, hasNext: more });
      if (step === 'saved') {
        saved += marks.saved.length;
        done = false;
        await tellPage(`в список ${marks.saved.length}`);
        if (more === false)
          await noteEnded(query);

        return 'saved';
      }

      return step;
    }

    async function noteMiss(): Promise<void> {
      if (missed || hangHalted() || sawCaptcha)
        return;

      missed = true;
      await tellPage('не прочиталась страница hh');
    }

    const openedFirst = new Set<string>();
    for (const query of queries) {
      const deep = storedPage(pages[query]);
      const hit = await harvest(query, FIRST_PAGE, deep);
      if (hit === 'login')
        return true;

      if (hit === 'miss')
        continue;

      if (hit === 'fail' || hit === 'saved')
        return false;

      if (hit === 'more')
        openedFirst.add(query);

      if (hit === 'end')
        await noteEnded(query);
    }

    for (const query of queries) {
      if (endedQuery.has(query))
        continue;

      let page = storedPage(pages[query]);
      if (page === FIRST_PAGE && openedFirst.has(query))
        page = 1;

      while (true) {
        const hit = await harvest(query, page, null);
        if (hit === 'login')
          return true;

        if (hit === 'miss')
          break;

        if (hit === 'fail' || hit === 'saved')
          return false;

        if (hit === 'more') {
          const next = pilotStep(freshPilot(), { type: 'page', page, hasNext: true }).page;
          if (next === null)
            break;

          page = next;
          continue;
        }

        if (await keep(query, page) === false)
          return false;

        await noteEnded(query);

        break;
      }
    }

    return false;
  });

  if (sawCaptcha)
    return miss(true, false, '');

  if (login)
    return { login: true, captcha: false, saved, more: false, done: false, reason: '' };

  if (missed && saved === 0)
    return miss(false, false, 'не прочиталась страница hh');

  if (checkFailed && saved === 0) {
    await tellPage('сервер не сверил вакансии');

    return miss(false, false, 'сервер не сверил вакансии');
  }

  return { login: false, captcha: false, saved, more: false, done, reason: '' };
}

export async function readVacancyPage(tabId: number, id: string, url: string): Promise<FoundCard | null> {
  const pulled = await readTab(tabId);
  if (pulled === null)
    return null;

  if (isLogin(pulled.url, pulled.html))
    return null;

  if (/\/vacancy\/\d+/i.test(pulled.url) === false)
    return null;

  return vacancyFromHtml(pulled.html, id, url);
}

type PageHit = 'login' | 'fail' | 'saved' | 'end' | 'more' | 'miss';

function heldPage(hold: number | null, page: number, more: boolean): number {
  if (hold !== null)
    return hold;

  if (more)
    return page + 1;

  return page;
}

async function noteEnded(query: string): Promise<void> {
  endedQuery.add(query);
  if (saidEnded)
    return;

  saidEnded = true;
  await tellPage('страницы кончились');
}

function storedPage(page: number | undefined): number {
  if (page === undefined || Number.isInteger(page) === false || page < 0)
    return 0;

  return page;
}

function landedEarlier(url: string, asked: number): boolean {
  try {
    const value = new URL(url).searchParams.get('page');
    if (value === null)
      return false;

    const landed = Number(value);

    return Number.isInteger(landed) && landed >= 0 && landed < asked;
  }
  catch {
    return false;
  }
}

function miss(captcha: boolean, login: boolean, reason: string): SearchHit {
  return { login, captcha, saved: 0, more: false, done: false, reason };
}

function searchUrl(query: string, page: number): string {
  const url = new URL(SEARCH);
  url.searchParams.set('text', query);
  url.searchParams.set('search_period', '3');
  url.searchParams.set('order_by', 'publication_time');
  url.searchParams.set('page', String(page));

  return url.toString();
}

const FRONT_QUERY = /frontend|front[\s-]?end|фронтенд|фронтэнд|vue|react/i;

export function huntSearchUrl(queries: readonly string[]): string {
  const front = queries.find(query => FRONT_QUERY.test(query));
  const text = (front ?? queries.find(query => query.trim().length > 0))?.trim();
  if (text === undefined || text.length === 0)
    return SEARCH;

  return searchUrl(text, FIRST_PAGE);
}

async function searchTab(queries: readonly string[]): Promise<number | null> {
  const live = await liveWorker();
  const tabId = live ?? await openSearch(queries);
  if (tabId === null)
    return null;

  await wakeWorkerTab(tabId);
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const url = tab?.url || tab?.pendingUrl || '';
  if (isHhUrl(url) === false)
    return null;

  if (onHhRoot(url))
    return tabId;

  await showUrl(tabId, HH_ROOT);

  return tabId;
}

async function liveWorker(): Promise<number | null> {
  try {
    const tab = await requireWorkerTab();
    if (typeof tab.id !== 'number')
      return null;

    const url = tab.url || tab.pendingUrl || '';
    if (isBotWorkUrl(url) === false)
      return null;

    return tab.id;
  }
  catch {
    return null;
  }
}

async function openSearch(queries: readonly string[]): Promise<number | null> {
  if ((await getFlags()).autoQueue !== true)
    return null;

  const opened = await openBotSearch(huntSearchUrl(queries));
  if (opened.ok === false || typeof opened.tabId !== 'number')
    return null;

  return opened.tabId;
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
  await flipPause();
  if (hangHalted())
    return null;

  const started = Date.now();
  const until = started + PAGE_LOAD_MS;
  const loaded = await loadWithin(readSearchPage(tabId, url, until), until - started);
  if (sawCaptcha || hangHalted())
    return null;

  if (loaded === undefined || loaded === null || pageLoadMiss(Date.now() - started))
    return null;

  return loaded;
}

async function readSearchPage(tabId: number, url: string, until: number): Promise<{ url: string; html: string } | null> {
  if (late(until))
    return null;

  await budget(wakeWorkerTab(tabId), until);
  if (late(until) || hangHalted() || await captchaNow(tabId, until))
    return null;

  const fetched = await fetchInPage(tabId, url, until);
  if (usable(fetched))
    return fetched;

  if (late(until) || hangHalted() || await captchaNow(tabId, until))
    return null;

  await showUrl(tabId, url, until);
  if (late(until) || sawCaptcha || hangHalted() || await captchaNow(tabId, until))
    return null;

  return readTab(tabId, until);
}

function usable(page: { url: string; html: string; ok: boolean } | null): page is { url: string; html: string; ok: boolean } {
  if (page === null)
    return false;

  if (isLogin(page.url, page.html))
    return true;

  return page.ok && page.html.length > 0 && isGuard(page.html) === false;
}

async function fetchInPage(tabId: number, url: string, until: number): Promise<{ url: string; html: string; ok: boolean } | null> {
  try {
    const results = await budget(browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fetchPage,
      args: [url, Math.max(1, until - Date.now())],
    }), until);
    if (results === null)
      return null;

    return asFetched(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function readTab(tabId: number, until = 0): Promise<{ url: string; html: string } | null> {
  const deadline = until > 0 ? until : Date.now() + PAGE_LOAD_MS;
  try {
    const results = await budget(browser.scripting.executeScript({
      target: { tabId },
      func: readPage,
    }), deadline);
    if (results === null)
      return null;

    return asHtml(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function showUrl(tabId: number, url: string, until = 0): Promise<void> {
  const deadline = until > 0 ? until : Date.now() + PAGE_LOAD_MS;
  if (late(deadline) || hangHalted() || await captchaNow(tabId, deadline))
    return;

  await budget(wakeWorkerTab(tabId), deadline);
  if (late(deadline) || hangHalted() || await captchaNow(tabId, deadline))
    return;

  const tab = await budget(browser.tabs.get(tabId).catch(() => null), deadline);
  if (late(deadline))
    return;

  const loaded = waitTab(tabId, Math.min(15_000, Math.max(0, deadline - Date.now())));
  const open = tab?.active === true ? { url } : { url, active: false };
  await budget(browser.tabs.update(tabId, open), deadline);
  await budget(loaded, deadline);
  if (late(deadline))
    return;

  await budget(pause(500, 1200), deadline);
}

function late(until: number): boolean {
  return Date.now() >= until;
}

function budget<T>(work: Promise<T>, until: number): Promise<T | null> {
  const ms = until - Date.now();
  if (ms <= 0)
    return Promise.resolve(null);

  return within(work, ms);
}

async function captchaNow(tabId: number, until: number): Promise<boolean> {
  const shown = await budget(tabShowsCaptcha(tabId), until);
  if (shown !== true)
    return false;

  sawCaptcha = true;

  return true;
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
    query: '',
  };
}

function vacancyFromHtml(html: string, id: string, url: string): FoundCard | null {
  const title = textAt(html, 'vacancy-title');
  if (title.length === 0)
    return null;

  const company = textAt(html, 'vacancy-company-name');
  const card: FoundCard = {
    id,
    title,
    company: company.length > 0 ? company : 'без компании',
    url,
    text: title,
    salaryFrom: null,
    salaryTo: null,
    currency: '',
    remote: false,
    experience: '',
    query: '',
  };
  fillText(card, html);
  card.remote = /удал[её]н|remote/i.test(card.text);

  return card;
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

function flipPause(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, flipWaitMs(Math.random())));
}

function pause(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min));

  return new Promise(resolve => setTimeout(resolve, ms));
}

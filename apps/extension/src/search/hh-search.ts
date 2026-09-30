import type { HideFace, HideStep } from './hide-popup';

import { getFlags } from '../pilot/flags';
import { freshPilot, pilotStep } from '../chrome/pilot';
import { tabShowsCaptcha } from '../tab/hh-captcha';
import { hangHalted, loadWithin, tellPage, tickPage, whileSearching } from '../pilot/page-log';
import { budgetSec, waitMark } from '../pilot/wait-pulse';
import { hideDom } from './hide-dom';
import { HIDE_POLL_MS, HIDE_POPUP_STUCK, hideBlocks, hideClickOk, hideFaceOf, hideLimit, hideStart, stepHide } from './hide-popup';
import { PAGE_LOAD_MS, endedAfter, flipWaitMs, hideWaitMs, landedPage, nextListedPage, nextPageNumber, pageLoadMiss, parsedSearch, putSearchPage, searchStep } from './page-load';
import { getWorkerTabId, isBotWorkUrl, isHhUrl, openBotSearch, requireWorkerTab, wakeWorkerTab, waitTab } from '../tab/worker-tab';
import { browser } from '../browser-host';

const HIDE_REASON = 'не подходит профессия';
const FIRST_PAGE = 0;
const endedQuery = new Set<string>();
let endedQuiet = false;
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

export type HiddenMark = {
  id: string;
  reason: string;
  title: string;
  company: string;
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
  noteHidden: (row: HiddenMark) => Promise<void>,
): Promise<SearchHit> {
  sawCaptcha = false;
  endedQuery.clear();
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
  let hideBlocked = false;
  const login = await whileSearching(async () => {
    async function keep(query: string, next: number): Promise<boolean> {
      if (await rememberPage({ query, page: next }))
        return true;

      checkFailed = true;
      done = false;

      return false;
    }

    let seenPage = FIRST_PAGE;
    const listedNext = new Map<string, number>();

    async function harvest(query: string, page: number, hold: number | null, gap: boolean): Promise<PageHit> {
      if (await releaseHidePopup(tabId) === 'stuck') {
        await tellPage(HIDE_POPUP_STUCK);
        hideBlocked = true;
        done = false;

        return 'fail';
      }

      if (gap)
        await flipPause();

      const pulled = await pull(tabId, searchUrl(query, page), page);
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

      if (parsedSearch(pulled.html) === false) {
        await noteMiss();

        return 'miss';
      }

      const here = landedPage(pulled.url, page);
      if (here !== page)
        return 'miss';

      seenPage = here;
      const batch = cardsOf(serpHtml(pulled.html));
      const nextPage = await listedAfter(tabId, pulled.html, here, batch.length);
      if (nextPage === null)
        listedNext.delete(query);
      else
        listedNext.set(query, nextPage);

      const more = nextPage !== null;
      if (batch.length === 0)
        return finish(query, searchStep({ saved: 0, hasNext: more }), more);

      const fitting = batch.filter(card => fitsTitle(card.title, queries));
      const marks = await knownOnPage(
        batch.map(card => card.id),
        fitting.map(card => ({ id: card.id, url: card.url, title: card.title })),
        { query, page: heldPage(hold, here, more) },
      );
      if (marks === null) {
        checkFailed = true;
        done = false;

        return 'fail';
      }

      const knownIds = batch.filter(card => marks.seen.has(card.id)).map(card => card.id);
      if (knownIds.length > 0)
        await tellPage(`уже видели, ${knownIds.length}`);

      const fresh = new Set(marks.saved);
      const cards = new Map(batch.map(card => [card.id, card]));
      const hidden = await hideKnown(tabId, pulled.url, knownIds.filter(id => fresh.has(id) === false), cards, noteHidden);
      if (hidden === false) {
        hideBlocked = true;
        done = false;

        return 'fail';
      }

      const step = searchStep({ saved: marks.saved.length, hasNext: more });
      if (step === 'saved') {
        saved += marks.saved.length;
        done = false;
        await tellPage(`в список ${marks.saved.length}`);
      }

      return finish(query, step, more);
    }

    async function finish(query: string, step: PageHit, more: boolean): Promise<PageHit> {
      if (more) {
        noteMore();

        return step;
      }

      await noteEnded(query, step === 'saved');

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
      const hit = await harvest(query, FIRST_PAGE, deep, false);
      if (hit === 'login')
        return true;

      if (hit === 'miss') {
        endedQuery.add(query);
        continue;
      }

      if (hit === 'fail' || hit === 'saved')
        return false;

      if (hit === 'more')
        openedFirst.add(query);
    }

    for (const query of queries) {
      if (endedQuery.has(query))
        continue;

      let page = storedPage(pages[query]);
      if (page === FIRST_PAGE && openedFirst.has(query)) {
        const listed = listedNext.get(query);
        page = listed === undefined ? nextPageNumber(page) : listed;
      }

      let gap = openedFirst.has(query);
      while (true) {
        const hit = await harvest(query, page, null, gap);
        if (hit === 'login')
          return true;

        if (hit === 'miss')
          break;

        if (hit === 'fail' || hit === 'saved')
          return false;

        if (hit === 'more') {
          const listed = listedNext.get(query);
          const next = pilotStep(freshPilot(), { type: 'page', page: seenPage, hasNext: listed !== undefined }).page;
          if (next === null || listed === undefined || listed === seenPage)
            break;

          page = listed;
          gap = true;
          continue;
        }

        if (await keep(query, seenPage) === false)
          return false;

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

  if (hideBlocked)
    return { login: false, captcha: false, saved, more: false, done: false, reason: HIDE_POPUP_STUCK };

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

function noteMore(): void {
  const line = endedAfter(endedQuiet, { fresh: false, hasNext: true });
  endedQuiet = line.quiet;
}

async function noteEnded(query: string, fresh: boolean): Promise<void> {
  endedQuery.add(query);
  const line = endedAfter(endedQuiet, { fresh, hasNext: false });
  endedQuiet = line.quiet;
  if (line.say === false)
    return;

  await tellPage('страницы кончились');
}

function storedPage(page: number | undefined): number {
  if (page === undefined || Number.isInteger(page) === false || page < 0)
    return 0;

  return page;
}

function miss(captcha: boolean, login: boolean, reason: string): SearchHit {
  return { login, captcha, saved: 0, more: false, done: false, reason };
}

function searchUrl(query: string, page: number): string {
  const url = new URL(SEARCH);
  url.searchParams.set('text', query);
  url.searchParams.set('search_period', '3');
  url.searchParams.set('order_by', 'publication_time');

  return putSearchPage(url.toString(), page);
}

async function listedAfter(tabId: number, html: string, page: number, cards: number): Promise<number | null> {
  const listed = nextListedPage(html, page);
  if (listed !== null || cards === 0)
    return listed;

  if (await revealPager(tabId) === false)
    return null;

  const again = await readTab(tabId);
  if (again === null || landedPage(again.url, -1) !== page)
    return null;

  return nextListedPage(again.html, page);
}

async function revealPager(tabId: number): Promise<boolean> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const url = tab?.url || tab?.pendingUrl || '';
  if (resumePath(url))
    return false;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: scrollPager,
    });
  }
  catch {
    return false;
  }

  await pause(400, 700);

  return true;
}

function scrollPager(): void {
  if (/\/resume(?:_converter|_print)?(?:\/|$)/i.test(location.pathname))
    return;

  const pager = document.querySelector('[data-qa="pager-page"], [data-qa="pager-next"]');
  if (pager instanceof HTMLElement) {
    pager.scrollIntoView({ block: 'end' });

    return;
  }

  window.scrollTo(0, document.body.scrollHeight);
}

async function hideKnown(
  tabId: number,
  url: string,
  ids: readonly string[],
  cards: ReadonlyMap<string, { title: string; company: string }>,
  noteHidden: (row: HiddenMark) => Promise<void>,
): Promise<boolean> {
  if (resumePath(url) || ids.length === 0)
    return true;

  for (let index = 0; index < ids.length; index += 1) {
    if (hangHalted())
      return true;

    const id = ids[index];
    if (id === undefined)
      continue;

    const hit = await settleHide(tabId, id);
    if (hit === 'halt')
      return true;

    if (hit === 'stuck') {
      await tellPage(HIDE_POPUP_STUCK);

      return false;
    }

    if (hit === 'done') {
      const card = cards.get(id);
      const company = card?.company ?? '';
      await noteHidden({
        id,
        reason: HIDE_REASON,
        title: card?.title ?? '',
        company: company === 'без компании' ? '' : company,
      });
    }

    if (hit === 'done' && index + 1 < ids.length)
      await hidePause();
  }

  return true;
}

export async function releaseHidePopup(tabId: number): Promise<'clear' | 'stuck'> {
  const before = await readHideFace(tabId);
  if (before === null || before === 'resume' || hideBlocks(before) === false)
    return 'clear';

  const hit = await runHide(tabId, hideStart());
  if (hit === 'stuck')
    return 'stuck';

  return 'clear';
}

async function settleHide(tabId: number, id: string): Promise<'done' | 'stuck' | 'skip' | 'halt'> {
  if (hangHalted())
    return 'halt';

  const before = await readHideFace(tabId);
  if (before === null || before === 'resume')
    return 'skip';

  if (hideBlocks(before)) {
    const held = await runHide(tabId, hideStart());
    if (held !== 'done')
      return held;
  }

  const eye = await hideCall(tabId, 'eye', id);
  if (eye === null || hideClickOk(eye) === false)
    return 'skip';

  return runHide(tabId, hideStart());
}

async function runHide(tabId: number, step: HideStep): Promise<'done' | 'stuck' | 'skip' | 'halt'> {
  let since = Date.now();
  let guard = 0;
  while (step.phase !== 'done' && step.phase !== 'stuck') {
    if (hangHalted())
      return 'halt';

    if (guard > 200)
      return 'stuck';

    guard += 1;
    const face = await readHideFace(tabId);
    if (face === null)
      return 'skip';

    if (face === 'resume')
      return 'skip';

    const waited = Date.now() - since >= hideLimit(step.phase);
    const move = stepHide(step, face, waited);
    const changed = hideMoved(step, move.step);
    if (move.action !== null) {
      await hideCall(tabId, move.action, '');
      since = Date.now();
    }
    else if (changed)
      since = Date.now();
    else if (waited === false)
      await hideTick();

    step = move.step;
  }

  if (step.phase === 'stuck')
    return 'stuck';

  return 'done';
}

function hideMoved(step: HideStep, next: HideStep): boolean {
  return next.phase !== step.phase || next.form !== step.form || next.retryMenu !== step.retryMenu || next.retried !== step.retried;
}

async function readHideFace(tabId: number): Promise<HideFace | 'resume' | null> {
  const raw = await hideCall(tabId, 'read', '');
  if (raw === null)
    return null;

  return hideFaceOf(raw);
}

async function hideCall(tabId: number, op: string, id: string): Promise<unknown> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: hideDom,
      args: [op, id],
    });

    return results[0]?.result;
  }
  catch {
    return null;
  }
}

function hidePause(): Promise<void> {
  const ms = hideWaitMs(Math.random());

  return tickPage('жду', ms, '', waitMark({
    id: 'hide.wait',
    human: 'скрытие',
    budget: budgetSec(ms),
    next: 'hide.look',
    hold: true,
  }));
}

function hideTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, HIDE_POLL_MS));
}

function resumePath(url: string): boolean {
  try {
    return /\/resume(?:_converter|_print)?(?:\/|$)/i.test(new URL(url).pathname);
  }
  catch {
    return false;
  }
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

// Карточки читаются из открытой вкладки. Ответ без выдачи не значит, что страницы кончились.
async function pull(tabId: number, url: string, page: number): Promise<{ url: string; html: string } | null> {
  if (hangHalted())
    return null;

  const started = Date.now();
  const until = started + PAGE_LOAD_MS;
  const loaded = await loadWithin(readSearchPage(tabId, url, until, page), until - started);
  if (sawCaptcha || hangHalted())
    return null;

  if (loaded === undefined || loaded === null || pageLoadMiss(Date.now() - started))
    return null;

  return loaded;
}

async function readSearchPage(tabId: number, url: string, until: number, page: number): Promise<{ url: string; html: string } | null> {
  if (late(until))
    return null;

  await budget(wakeWorkerTab(tabId), until);
  if (await blocked(tabId, until))
    return null;

  await showUrl(tabId, url, until);
  if (sawCaptcha || await blocked(tabId, until))
    return null;

  return readUntilSerp(tabId, until, page);
}

async function readUntilSerp(tabId: number, until: number, want: number): Promise<{ url: string; html: string } | null> {
  while (late(until) === false && hangHalted() === false) {
    if (await captchaNow(tabId, until))
      return null;

    const page = await readTab(tabId, until);
    if (openedAsk(page, want))
      return page;

    if (await waitBit(until) === false)
      return null;
  }

  return null;
}

function openedAsk(page: { url: string; html: string } | null, want: number): page is { url: string; html: string } {
  if (page === null)
    return false;

  if (isLogin(page.url, page.html))
    return true;

  if (parsedSearch(page.html) === false)
    return false;

  return landedPage(page.url, -1) === want;
}

async function waitBit(until: number): Promise<boolean> {
  if (late(until))
    return false;

  await budget(pause(400, 800), until);

  return late(until) === false;
}

async function blocked(tabId: number, until: number): Promise<boolean> {
  if (late(until) || hangHalted())
    return true;

  return captchaNow(tabId, until);
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
  if (await blocked(tabId, deadline))
    return;

  await budget(wakeWorkerTab(tabId), deadline);
  if (await blocked(tabId, deadline))
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

function readPage(): { url: string; html: string } {
  const root = document.documentElement;

  return {
    url: location.href,
    html: root ? root.outerHTML.slice(0, 1_500_000) : '',
  };
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

  const piece = (end < 0 ? rest : rest.slice(0, end)).replace(/<svg\b[\s\S]*$/i, ' ');

  return decode(piece);
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

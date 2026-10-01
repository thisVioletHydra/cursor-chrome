export const PAGE_LOAD_MS = 45_000;
export const FLIP_MIN_MS = 2_000;
export const FLIP_MAX_MS = 4_000;
export const HIDE_MIN_MS = 1_000;
export const HIDE_MAX_MS = 8_000;

const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;
const SEARCH_TICK = /^ищу вакансию, \d+ с$/;
const PAGE_TICK = /^жду страницу, \d+ с$/;
const STATE_PULSE = /^~[a-z][a-z0-9.]*\|[^|]+\|(?:-|\d+)\|\d+\|[a-z][a-z0-9.]*\|[wsp]\|[01]$/;

export type PageStep = 'saved' | 'more' | 'end';

export function pageLoadMiss(waitedMs: number): boolean {
  if (Number.isFinite(waitedMs) === false)
    return true;

  return waitedMs > PAGE_LOAD_MS;
}

export function flipWaitMs(roll: number): number {
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;

  return FLIP_MIN_MS + Math.floor(unit * (FLIP_MAX_MS - FLIP_MIN_MS));
}

export function hideWaitMs(roll: number): number {
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;
  const span = (HIDE_MAX_MS - HIDE_MIN_MS) / 1_000;
  const step = Math.min(span, Math.floor(unit * (span + 1)));

  return HIDE_MIN_MS + step * 1_000;
}

export function nextPageNumber(page: number): number {
  if (Number.isInteger(page) === false || page < 0)
    return 0;

  return page + 1;
}

export function putSearchPage(url: string, page: number): string {
  const next = new URL(url);
  next.searchParams.set('page', String(page));

  return next.toString();
}

const SERP_CARD = 'data-qa="vacancy-serp__vacancy"';
const SERP_NEXT = 'data-qa="pager-next"';
const SERP_EMPTY = 'data-qa="vacancy-search-empty"';

export function searchStep(input: { saved: number; hasNext: boolean }): PageStep {
  if (input.saved > 0)
    return 'saved';

  if (input.hasNext)
    return 'more';

  return 'end';
}

export function parsedSearch(html: string): boolean {
  if (html.includes(SERP_CARD))
    return true;

  if (html.includes(SERP_NEXT))
    return true;

  return html.includes(SERP_EMPTY);
}

export function searchHasNext(html: string): boolean {
  return html.includes(SERP_NEXT);
}

export function nextListedPage(html: string, page: number): number | null {
  const nextHref = hrefPages(html, 'pager-next');
  const higherNext = nextHref.find(item => item > page);
  if (higherNext !== undefined)
    return higherNext;

  const higherList = hrefPages(html, 'pager-page').find(item => item > page);
  if (higherList !== undefined)
    return higherList;

  if (html.includes(SERP_NEXT) && nextHref.length === 0)
    return nextPageNumber(page);

  return null;
}

function hrefPages(html: string, qa: string): number[] {
  const pages: number[] = [];
  const marker = `data-qa="${qa}"`;
  let at = html.indexOf(marker);
  while (at >= 0) {
    const start = html.lastIndexOf('<', at);
    const end = html.indexOf('>', at);
    const tag = start >= 0 && end > start ? html.slice(start, end + 1) : '';
    const href = tag.match(/href="([^"]*)"/);
    const value = href?.[1].match(/(?:^|[?&])(?:amp;)?page=(\d+)/);
    if (value !== undefined) {
      const parsed = Number(value[1]);
      if (Number.isInteger(parsed))
        pages.push(parsed);
    }

    at = html.indexOf(marker, at + marker.length);
  }

  pages.sort((left, right) => left - right);

  return pages;
}

export function queryText(url: string): string {
  try {
    return new URL(url).searchParams.get('text')?.trim() ?? '';
  }
  catch {
    return '';
  }
}

export function feedAddress(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().endsWith('hh.ru') === false)
      return false;

    if (parsed.pathname !== '/search/vacancy')
      return false;

    return parsed.searchParams.get('search_period') === '7' && parsed.searchParams.get('ored_clusters') === 'true';
  }
  catch {
    return false;
  }
}

export function sameQuery(url: string, query: string): boolean {
  const right = query.trim().toLowerCase();
  if (right.length === 0)
    return feedAddress(url) || (queryText(url).length === 0 && vacancySearch(url));

  const left = queryText(url).toLowerCase();

  return left.length > 0 && left === right;
}

function vacancySearch(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.hostname.toLowerCase().endsWith('hh.ru') && parsed.pathname === '/search/vacancy';
  }
  catch {
    return false;
  }
}

export function explicitPage(url: string): number | null {
  try {
    const value = new URL(url).searchParams.get('page');
    if (value === null)
      return null;

    const page = Number(value);
    if (Number.isInteger(page) && page >= 0)
      return page;
  }
  catch {
    return null;
  }

  return null;
}

export function searchReady(url: string, html: string, query: string, want: number, moved: boolean): boolean {
  if (parsedSearch(html) === false)
    return false;

  if (sameQuery(url, query) === false)
    return false;

  const landed = explicitPage(url);
  if (landed === null)
    return want === 0;

  if (landed === want)
    return true;

  return moved && landed < want;
}

export function landedPage(url: string, asked: number): number {
  try {
    const value = new URL(url).searchParams.get('page');
    if (value === null)
      return asked;

    const landed = Number(value);
    if (Number.isInteger(landed) && landed >= 0)
      return landed;
  }
  catch {
    return asked;
  }

  return asked;
}

export function endedAfter(quiet: boolean, live: { fresh: boolean; hasNext: boolean }): { quiet: boolean; say: boolean } {
  if (live.hasNext)
    return { quiet: false, say: false };

  if (live.fresh || quiet === false)
    return { quiet: true, say: true };

  return { quiet: true, say: false };
}

export function liveTick(text: string): boolean {
  return text === 'ищу вакансию' || TICK.test(text) || SEARCH_TICK.test(text) || PAGE_TICK.test(text) || STATE_PULSE.test(text);
}

export function foldLiveLine(lines: readonly string[], text: string): string[] {
  const next = lines.slice();
  const previous = next[next.length - 1] ?? '';
  if (previous === text)
    return next;

  if (next.length > 0 && liveTick(previous) && liveTick(text)) {
    next[next.length - 1] = text;

    return next;
  }

  next.push(text);

  return next;
}

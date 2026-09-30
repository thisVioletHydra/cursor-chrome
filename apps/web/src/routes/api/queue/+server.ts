import type { RequestHandler } from './$types';

import { COVER_LETTER, busyAmong, dayOpen, forgetLinks, forgetSearchPages, heldAmong, keepLinks, keepSearchTitle, knownAmong, parseRules, pending, pendingCount, QUEUE_TARGET, readLinks, readMemory, readState, remember, rememberSearchPage, searchPages, serveQueries, splitQueries, takePilotStart, workHours, writeState } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { DEFAULT_QUERY, readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request, url }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [memory, account, state] = await Promise.all([readMemory(), readAccount(login), readState()]);
  const letter = account.coverLetter || COVER_LETTER;
  const saved = splitQueries(account.hhQuery || DEFAULT_QUERY);
  const stop = state.hung === true && state.auto === false;
  const auto = state.auto === true;
  const listen = url.searchParams.get('listen') === '1';
  const start = listen ? takePilotStart() : false;
  const hours = account.hhHours !== '0';
  const day = dayOpen(memory);
  const open = (hours === false || workHours()) && day;
  if (open === false)
    return json({ items: [], links: [], letter, queries: saved, want: false, imitation: account.imitation, stop, hours, auto, start, day });

  const queued = await pendingCount();
  const want = account.hhLive === '1' && state.auto && queued < QUEUE_TARGET;
  const cycle = url.searchParams.get('cycle') === '1';
  const queries = want && listen === false ? await shownPass(saved, state, cycle) : saved;
  const [items, links, pages] = await Promise.all([pending(10), keptLinks(account.hhRules), searchPages(queries)]);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    links,
    pages,
    letter,
    queries,
    want,
    imitation: account.imitation,
    stop,
    hours,
    auto,
    start,
    day: true,
  });
}

const PAGE_IDS = 100;

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { ids?: unknown; links?: unknown; drop?: unknown; cursor?: unknown; resetPages?: unknown; gate?: unknown; opened?: unknown } | null;
  if (body === null)
    return json({ error: 'пустое тело' }, { status: 400 });

  if (body.gate !== undefined) {
    const known = await knownIds(pageIds(body.gate));
    if (known.length > 0)
      await forgetLinks(known);

    return json({ known });
  }

  if (body.opened !== undefined) {
    const id = pageIds([body.opened])[0];
    if (id === undefined)
      return json({ open: false });

    const known = await knownIds([id]);
    if (known.length > 0) {
      await forgetLinks([id]);

      return json({ open: false });
    }

    await remember([id]);

    return json({ open: true });
  }

  const cursor = cursorOf(body.cursor);
  if (body.ids === undefined && body.links === undefined) {
    if (cursor !== null)
      await rememberSearchPage(cursor.query, cursor.page);

    if (body.resetPages !== undefined)
      await forgetSearchPages(pageQueries(body.resetPages));

    if (body.drop !== undefined)
      await forgetLinks(pageIds(body.drop));

    return json({ ok: true });
  }

  const account = await readAccount(login);
  const ids = pageIds(body.ids);
  const links = pageLinks(body.links).filter(link => keepSearchTitle(link.title, rulesOf(account.hhRules).stopWords));
  const asked = ids.length > 0 ? ids : links.map(link => link.id);
  const seen = await knownIds(asked);
  const seenSet = new Set(seen);
  const held = new Set(await heldAmong(links.map(link => link.id)));
  const fresh = links.filter(link => seenSet.has(link.id) === false && held.has(link.id) === false);
  const saved = await keepLinks(fresh);
  if (cursor !== null)
    await rememberSearchPage(cursor.query, cursor.page);

  return json({ seen, saved });
}

async function keptLinks(rawRules: string): Promise<{ id: string; url: string }[]> {
  const stopWords = rulesOf(rawRules).stopWords;
  const rows = await readLinks(40);
  const junk = rows.filter(row => row.title.length > 0 && keepSearchTitle(row.title, stopWords) === false);
  if (junk.length > 0)
    await forgetLinks(junk.map(row => row.id));

  const dropped = new Set(junk.map(row => row.id));

  return rows.filter(row => dropped.has(row.id) === false).slice(0, 10).map(row => ({ id: row.id, url: row.url }));
}

function rulesOf(raw: string): { stopWords: string[] } {
  if (raw.trim().length === 0)
    return parseRules(null);

  try {
    return parseRules(JSON.parse(raw));
  }
  catch {
    return parseRules(null);
  }
}

function cursorOf(value: unknown): { query: string; page: number } | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const query = 'query' in value && typeof value.query === 'string' ? value.query.trim() : '';
  const page = 'page' in value && typeof value.page === 'number' ? value.page : -1;
  if (query.length === 0 || query.length > 80)
    return null;

  if (storedPage(page) === null)
    return null;

  return { query, page };
}

function storedPage(page: number): number | null {
  if (Number.isInteger(page) === false)
    return null;

  if (page < 0)
    return null;

  return page;
}

function pageQueries(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  const queries: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string')
      continue;

    const query = item.trim();
    if (query.length === 0 || query.length > 80)
      continue;

    queries.push(query);
    if (queries.length >= 20)
      break;
  }

  return queries;
}

async function knownIds(ids: string[]): Promise<string[]> {
  const [known, busy] = await Promise.all([knownAmong(ids), busyAmong(ids)]);
  const hit = new Set<string>([...known, ...busy]);

  return ids.filter(id => hit.has(id));
}

function pageLinks(value: unknown): { id: string; url: string; title: string }[] {
  if (Array.isArray(value) === false)
    return [];

  const links: { id: string; url: string; title: string }[] = [];
  for (const item of value) {
    const link = linkOf(item);
    if (link === null)
      continue;

    links.push(link);
    if (links.length >= PAGE_IDS)
      break;
  }

  return links;
}

function linkOf(value: unknown): { id: string; url: string; title: string } | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const id = 'id' in value && typeof value.id === 'string' ? value.id : '';
  const url = 'url' in value && typeof value.url === 'string' ? value.url : '';
  const title = 'title' in value && typeof value.title === 'string' ? value.title.trim().slice(0, 200) : '';
  if (/^\d+$/.test(id) === false || title.length === 0)
    return null;

  if (url !== `https://hh.ru/vacancy/${id}`)
    return null;

  return { id, url, title };
}

function pageIds(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || /^\d+$/.test(item) === false)
      continue;

    ids.push(item);
    if (ids.length >= PAGE_IDS)
      break;
  }

  return ids;
}

async function shownPass(saved: string[], state: { frontAt: number; lessAt: number; queryPass: number }, advance: boolean): Promise<string[]> {
  const served = serveQueries(saved, {
    frontAt: state.frontAt,
    lessAt: state.lessAt,
    queryPass: state.queryPass,
  }, advance);
  if (served.cursor.frontAt !== state.frontAt || served.cursor.lessAt !== state.lessAt || served.cursor.queryPass !== state.queryPass)
    await writeState({ frontAt: served.cursor.frontAt, lessAt: served.cursor.lessAt, queryPass: served.cursor.queryPass });

  return served.queries;
}


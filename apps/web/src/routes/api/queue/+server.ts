import type { RequestHandler } from './$types';

import { COVER_LETTER, dayOpen, forgetLinks, heldAmong, keepLinks, knownAmong, pending, pendingCount, QUEUE_TARGET, readLinks, readMemory, readQueue, readState, serveQueries, splitQueries, takePilotStart, workHours, writeState } from '@cursor-chrome/hh';
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
  const open = (hours === false || workHours()) && dayOpen(memory);
  if (open === false)
    return json({ items: [], links: [], letter, queries: saved, want: false, imitation: account.imitation, stop, hours, auto, start });

  const queued = await pendingCount();
  const want = account.hhLive === '1' && state.auto && queued < QUEUE_TARGET;
  const cycle = url.searchParams.get('cycle') === '1';
  const queries = want && listen === false ? await shownPass(saved, state, cycle) : saved;
  const [items, links] = await Promise.all([pending(10), readLinks(10)]);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    links,
    letter,
    queries,
    want,
    imitation: account.imitation,
    stop,
    hours,
    auto,
    start,
  });
}

const PAGE_IDS = 100;

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { ids?: unknown; links?: unknown; drop?: unknown } | null;
  if (body === null)
    return json({ error: 'пустое тело' }, { status: 400 });

  if (body.ids === undefined && body.links === undefined) {
    await forgetLinks(pageIds(body.drop));

    return json({ ok: true });
  }

  const ids = pageIds(body.ids);
  const links = pageLinks(body.links);
  const asked = ids.length > 0 ? ids : links.map(link => link.id);
  const seen = await seenOnPage(asked);
  const seenSet = new Set(seen);
  const held = new Set(await heldAmong(links.map(link => link.id)));
  const fresh = links.filter(link => seenSet.has(link.id) === false && held.has(link.id) === false);
  const saved = await keepLinks(fresh);

  return json({ seen, saved });
};

async function seenOnPage(ids: string[]): Promise<string[]> {
  const [known, queue] = await Promise.all([knownAmong(ids), readQueue()]);
  const hit = new Set(known);
  const asked = new Set(ids);
  for (const row of queue) {
    if (asked.has(row.id))
      hit.add(row.id);
  }

  return ids.filter(id => hit.has(id));
}

function pageLinks(value: unknown): { id: string; url: string }[] {
  if (Array.isArray(value) === false)
    return [];

  const links: { id: string; url: string }[] = [];
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

function linkOf(value: unknown): { id: string; url: string } | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const id = 'id' in value && typeof value.id === 'string' ? value.id : '';
  const url = 'url' in value && typeof value.url === 'string' ? value.url : '';
  if (/^\d+$/.test(id) === false)
    return null;

  if (url !== `https://hh.ru/vacancy/${id}`)
    return null;

  return { id, url };
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


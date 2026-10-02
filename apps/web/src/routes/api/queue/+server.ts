import type { State } from '@cursor-chrome/hh';
import type { RequestHandler } from './$types';

import { COVER_LETTER, DEFAULT_QUERY, HIDE_REASON, busyAmong, coveredWaiters, dayOpen, dropWaiters, forgetAllLinks, forgetLinks, forgetSearchPages, heldAmong, keepLinks, knownAmong, moscowDay, noteHidden, notePassed, parseRules, pending, pendingCount, QUEUE_TARGET, readLinks, readMemory, readQueue, readState, rememberSearchPage, searchPages, splitQueries, stepWalk, takePilotStart, takeRelook, walkFrom, workHours, writeState } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request, url }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [memory, account, loaded] = await Promise.all([readMemory(), readAccount(login), readState()]);
  const state = await walkToday(loaded);
  const letter = account.coverLetter || COVER_LETTER;
  const saved = ['лента'];
  const words = splitQueries(account.hhQuery.trim() || DEFAULT_QUERY).filter(line => line.startsWith('-') === false).slice(0, 20);
  const stop = state.hung === true && state.auto === false;
  const auto = state.auto === true;
  const listen = url.searchParams.get('listen') === '1';
  const start = listen ? takePilotStart() : false;
  const hours = account.hhHours !== '0';
  const day = dayOpen(memory);
  const open = (hours === false || workHours()) && day;
  const walked = walkFrom(state);
  const spot = saved.length === 0 || walked.at < saved.length ? walked.at : 0;
  const focus = saved[spot] ?? '';
  if (spot !== state.walkAt)
    await writeState({ walkAt: spot });

  if (open === false)
    return json({ items: [], links: [], letter, queries: saved, words, focus, depth: walked.left, phase: walked.phase, want: false, imitation: account.imitation, stop, hours, auto, start, day });

  const queued = await pendingCount();
  const want = account.hhLive === '1' && state.auto && queued < QUEUE_TARGET;
  const [items, links, pages] = await Promise.all([pending(10), keptLinks(), searchPages(saved)]);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    links,
    pages,
    letter,
    queries: saved,
    words,
    focus,
    depth: walked.left,
    phase: walked.phase,
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

  const body = await request.json().catch(() => null) as { ids?: unknown; links?: unknown; drop?: unknown; dropAll?: unknown; cursor?: unknown; resetPages?: unknown; gate?: unknown; opened?: unknown; hidden?: unknown; walk?: unknown; relook?: unknown } | null;
  if (body === null)
    return json({ error: 'пустое тело' }, { status: 400 });

  if (typeof body.relook === 'number') {
    const queue = await readQueue();
    const busy = queue.filter(row => row.status === 'pending' || row.status === 'sent' || row.status === 'needsHuman').map(row => row.id);
    const rows = await takeRelook(busy, body.relook);

    return json({
      relook: rows.map(row => ({
        id: row.id,
        company: row.company,
        title: row.title,
        url: `https://hh.ru/vacancy/${row.id}`,
      })),
    });
  }

  if (body.hidden !== undefined) {
    const hidden = hiddenNotes(body.hidden);
    await noteHidden(hidden.map(row => row.id));
    const queue = await readQueue();
    const busy = new Set(queue.filter(row => row.status === 'pending' || row.status === 'sent' || row.status === 'needsHuman').map(row => row.id));
    await notePassed(hidden.filter(row => busy.has(row.id) === false));
    const ids = coveredWaiters(await readQueue(), hidden.map(row => row.id));
    if (ids.length > 0) {
      await forgetLinks(ids);
      await dropWaiters(ids);
    }

    return json({ ok: true });
  }

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

    return json({ open: true });
  }

  const walked = walkNote(body.walk);
  if (walked !== null) {
    const account = await readAccount(login);
    const saved = ['лента'];
    const state = await walkToday(await readState());
    const next = stepWalk(walkFrom(state), saved.length, walked.read, walked.done, Math.random());
    await writeState({ walkPhase: next.phase, walkAt: next.at, walkLeft: next.left, walkDay: moscowDay() });

    return json({ ok: true });
  }

  const cursor = cursorOf(body.cursor);
  if (body.ids === undefined && body.links === undefined) {
    if (cursor !== null)
      await rememberSearchPage(cursor.query, cursor.page);

    if (body.resetPages !== undefined)
      await forgetSearchPages(pageQueries(body.resetPages));

    if (body.dropAll === true)
      await forgetAllLinks();

    if (body.drop !== undefined)
      await forgetLinks(pageIds(body.drop));

    return json({ ok: true });
  }

  const account = await readAccount(login);
  const ids = pageIds(body.ids);
  const links = await keptSearch(pageLinks(body.links), rulesOf(account.hhRules).stopWords);
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

async function keptSearch(links: { id: string; url: string; title: string }[], stopWords: string[]): Promise<{ id: string; url: string; title: string }[]> {
  void stopWords;

  return links;
}

async function keptLinks(): Promise<{ id: string; url: string }[]> {
  const rows = await readLinks(40);

  return rows.slice(0, 10).map(row => ({ id: row.id, url: row.url }));
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

function hiddenNotes(value: unknown): { id: string; reason: string; company: string; title: string }[] {
  if (Array.isArray(value) === false)
    return [];

  const notes: { id: string; reason: string; company: string; title: string }[] = [];
  for (const item of value) {
    const note = hiddenNote(item);
    if (note === null)
      continue;

    notes.push(note);
    if (notes.length >= PAGE_IDS)
      break;
  }

  return notes;
}

function hiddenNote(value: unknown): { id: string; reason: string; company: string; title: string } | null {
  if (typeof value === 'string')
    return hideNote(value, HIDE_REASON, '', '');

  if (typeof value !== 'object' || value === null)
    return null;

  const id = 'id' in value && typeof value.id === 'string' ? value.id : '';
  const reason = 'reason' in value && typeof value.reason === 'string' ? value.reason.trim().slice(0, 200) : '';
  const company = 'company' in value && typeof value.company === 'string' ? value.company.trim().slice(0, 200) : '';
  const title = 'title' in value && typeof value.title === 'string' ? value.title.trim().slice(0, 200) : '';

  return hideNote(id, reason.length > 0 ? reason : HIDE_REASON, company, title);
}

function hideNote(id: string, reason: string, company: string, title: string): { id: string; reason: string; company: string; title: string } | null {
  if (/^\d+$/.test(id) === false || reason === 'уже видели')
    return null;

  return { id, reason, company, title };
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

async function walkToday(state: State): Promise<State> {
  if (state.walkDay === moscowDay())
    return state;

  return writeState({ walkPhase: 'cover', walkAt: 0, walkLeft: 1, walkDay: moscowDay() });
}

function walkNote(value: unknown): { read: number; done: boolean } | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const raw = value as { read?: unknown; done?: unknown };
  const read = typeof raw.read === 'number' && Number.isFinite(raw.read) ? Math.max(0, Math.floor(raw.read)) : 0;

  return { read, done: raw.done === true };
}


import { setCoverLetter } from '../hh/letter';
import { noteHours } from './hours-flag';
import { haltHang, pilotStamp } from '../pilot/page-log';
import { noteGateway, notePilotAnswer, noteServerSilent, remoteStopCounts } from '../pilot/pilot-link';
import { rememberPace } from './pace';

export type QueueItem = { id: string; company: string; title: string; url: string };

export type SavedLink = { id: string; url: string };

export type PageMarks = { seen: string[]; saved: string[] };

export type Hunt = { items: QueueItem[]; queries: string[]; want: boolean; pages: Record<string, number>; day: boolean };

export { keepWorkHours } from './hours-flag';

export async function fetchHunt(base: string, key: string, advance = false): Promise<Hunt | null> {
  const body = await getQueue(base, key, advance);
  if (body === null)
    return null;

  return {
    items: Array.isArray(body.items) ? body.items.filter(isItem) : [],
    queries: stringsOf(body.queries),
    want: body.want === true,
    pages: pagesOf(body.pages),
    day: body.day !== false,
  };
}

export async function fetchQueue(base: string, key: string): Promise<QueueItem[] | null> {
  const body = await getQueue(base, key);
  if (body === null)
    return null;

  if (Array.isArray(body.items) === false)
    return [];

  return body.items.filter(isItem);
}

export type FoundReply = { ok: boolean; added: number; reason: string };

export async function postFound(base: string, key: string, cards: unknown[]): Promise<FoundReply> {
  try {
    const res = await fetch(`${base}/api/found`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancies: cards }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; added?: unknown; reason?: unknown; error?: unknown } | null;
    if (body === null)
      return { ok: false, added: 0, reason: res.ok ? 'пустое тело' : `сервер ${res.status}` };

    const reason = typeof body.reason === 'string'
      ? body.reason
      : typeof body.error === 'string' ? body.error : '';
    const added = typeof body.added === 'number' ? body.added : 0;
    if (res.ok === false)
      return { ok: false, added, reason: reason.length > 0 ? reason : `сервер ${res.status}` };

    return { ok: body.ok !== false, added, reason };
  }
  catch {
    return { ok: false, added: 0, reason: 'сервер не ответил' };
  }
}

export async function seenAmong(
  base: string,
  key: string,
  ids: readonly string[],
  links: readonly SavedLink[],
  cursor: { query: string; page: number },
): Promise<PageMarks | null> {
  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ids, links, cursor }),
    });
    if (res.ok === false)
      return null;

    const body = await res.json() as { seen?: unknown; saved?: unknown };

    return { seen: idsOf(body.seen), saved: idsOf(body.saved) };
  }
  catch {
    return null;
  }
}

export async function fetchLinks(base: string, key: string): Promise<SavedLink[] | null> {
  const body = await getQueue(base, key);
  if (body === null)
    return null;

  return linksOf(body.links);
}

export async function rememberPage(base: string, key: string, cursor: { query: string; page: number }): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ cursor }),
    });

    return res.ok;
  }
  catch {
    return false;
  }
}

export async function dropKnown(base: string, key: string, ids: readonly string[]): Promise<string[] | null> {
  if (ids.length === 0)
    return [];

  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ gate: ids }),
    });
    if (res.ok === false)
      return null;

    const body = await res.json() as { known?: unknown };

    return idsOf(body.known);
  }
  catch {
    return null;
  }
}

export async function postHidden(base: string, key: string, id: string): Promise<boolean> {
  if (/^\d+$/.test(id) === false)
    return false;

  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ hidden: [id] }),
      signal: AbortSignal.timeout(12_000),
    });

    return res.ok;
  }
  catch {
    return false;
  }
}

export async function markRead(base: string, key: string, id: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ opened: id }),
    });
    if (res.ok === false)
      return null;

    const body = await res.json() as { open?: unknown };

    return body.open === true;
  }
  catch {
    return null;
  }
}

export async function dropLinks(base: string, key: string, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0)
    return true;

  try {
    const res = await fetch(`${base}/api/queue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ drop: ids }),
    });

    return res.ok;
  }
  catch {
    return false;
  }
}

async function getQueue(base: string, key: string, advance = false): Promise<{ items?: unknown; links?: unknown; pages?: unknown; letter?: unknown; queries?: unknown; want?: unknown; imitation?: unknown; hours?: unknown; day?: unknown } | null> {
  const stamp = pilotStamp();
  try {
    const path = advance ? '/api/queue?cycle=1' : '/api/queue';
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok === false) {
      if (stamp === pilotStamp())
        await noteGateway(res.status);

      return null;
    }

    const body = await res.json() as { items?: unknown; letter?: unknown; queries?: unknown; want?: unknown; imitation?: unknown; stop?: unknown; hours?: unknown; day?: unknown };
    noteHours(body);

    if (body.stop === true && stamp === pilotStamp() && await remoteStopCounts())
      await haltHang();
    else
      await notePilotAnswer(body);

    if (typeof body.letter === 'string')
      await setCoverLetter(body.letter);

    await rememberPace(body.imitation);

    return body;
  }
  catch {
    if (stamp === pilotStamp())
      await noteServerSilent();

    return null;
  }
}

export async function fetchResumeId(base: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/resume`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok === false)
      return null;

    const body = await res.json() as { id?: unknown };

    return typeof body.id === 'string' ? body.id : '';
  }
  catch {
    return null;
  }
}

export async function postResume(base: string, key: string, id: string, text: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const res = await fetch(`${base}/api/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ id, text }),
    });
    const body = await res.json().catch(() => null) as { ok?: unknown; reason?: unknown; error?: unknown } | null;
    const reason = typeof body?.reason === 'string'
      ? body.reason
      : typeof body?.error === 'string' ? body.error : '';
    if (res.ok === false)
      return { ok: false, reason: reason.length > 0 ? reason : `сервер ${res.status}` };

    return { ok: body?.ok !== false, reason };
  }
  catch {
    return { ok: false, reason: 'сервер не ответил' };
  }
}

function linksOf(value: unknown): SavedLink[] {
  if (Array.isArray(value) === false)
    return [];

  const links: SavedLink[] = [];
  for (const item of value) {
    const link = savedLink(item);
    if (link === null)
      continue;

    links.push(link);
  }

  return links;
}

function pageNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' || Number.isInteger(raw) === false)
    return null;

  if (raw < 0)
    return null;

  return raw;
}

function pagesOf(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {};

  const pages: Record<string, number> = {};
  for (const [query, raw] of Object.entries(value)) {
    const text = query.trim();
    const page = pageNumber(raw);
    if (text.length === 0 || page === null)
      continue;

    pages[text] = page;
  }

  return pages;
}

function savedLink(value: unknown): SavedLink | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const id = 'id' in value && typeof value.id === 'string' ? value.id : '';
  const url = 'url' in value && typeof value.url === 'string' ? value.url : '';
  if (/^\d+$/.test(id) === false || url.length === 0)
    return null;

  return { id, url };
}

function idsOf(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  return value.filter((item): item is string => typeof item === 'string' && /^\d+$/.test(item));
}

function stringsOf(value: unknown): string[] {
  if (Array.isArray(value) === false)
    return [];

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null)
    return false;

  const row = value as Record<string, unknown>;

  return typeof row.id === 'string' && typeof row.url === 'string' && typeof row.company === 'string' && typeof row.title === 'string';
}

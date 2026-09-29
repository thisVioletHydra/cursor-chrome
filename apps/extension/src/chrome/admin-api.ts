import { setCoverLetter } from '../hh/letter';
import { rememberPace } from './pace';

export type QueueItem = { id: string; company: string; title: string; url: string };

export type Hunt = { items: QueueItem[]; queries: string[]; want: boolean };

export async function fetchHunt(base: string, key: string): Promise<Hunt | null> {
  const body = await getQueue(base, key);
  if (body === null)
    return null;

  return {
    items: Array.isArray(body.items) ? body.items.filter(isItem) : [],
    queries: stringsOf(body.queries),
    want: body.want === true,
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

async function getQueue(base: string, key: string): Promise<{ items?: unknown; letter?: unknown; queries?: unknown; want?: unknown; imitation?: unknown } | null> {
  try {
    const res = await fetch(`${base}/api/queue`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok === false)
      return null;

    const body = await res.json() as { items?: unknown; letter?: unknown; queries?: unknown; want?: unknown; imitation?: unknown };
    if (typeof body.letter === 'string')
      await setCoverLetter(body.letter);

    await rememberPace(body.imitation);

    return body;
  }
  catch {
    return null;
  }
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

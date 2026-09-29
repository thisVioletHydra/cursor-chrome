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

export async function postFound(base: string, key: string, cards: unknown[]): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/found`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancies: cards }),
    });

    return res.ok;
  }
  catch {
    return false;
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

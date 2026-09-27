import { MAX_ATTEMPTS } from './limits.ts';
import { storePath } from './memory.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type QueueStatus = 'pending' | 'sent' | 'needsHuman' | 'dropped';

export type Outcome = 'invitation' | 'discard' | 'response';

export type QueueItem = {
  id: string;
  company: string;
  title: string;
  url: string;
  reason: string;
  at: number;
  status: QueueStatus;
  doneAt?: number;
  hints?: string[];
  score?: number;
  attempts?: number;
  lastError?: string;
  outcome?: Outcome;
  outcomeAt?: number;
};

const MAX = 600;
const STATUSES: QueueStatus[] = ['pending', 'sent', 'needsHuman', 'dropped'];
const OUTCOMES: Outcome[] = ['invitation', 'discard', 'response'];

export function queuePath(): string {
  return path.join(path.dirname(storePath()), 'queue.json');
}

export async function readQueue(): Promise<QueueItem[]> {
  let text: string;
  try {
    text = await fsPromises.readFile(queuePath(), 'utf8');
  }
  catch {
    return [];
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null || Array.isArray(parsed.value) === false)
    return [];

  return parsed.value.filter(isItem);
}

export async function writeQueue(items: QueueItem[]): Promise<void> {
  await writeJsonAtomic(queuePath(), items.slice(0, MAX));
}

export async function enqueue(item: Omit<QueueItem, 'at' | 'status'>): Promise<boolean> {
  const queue = await readQueue();
  if (queue.some(row => row.id === item.id))
    return false;

  await writeQueue([{ ...item, at: Date.now(), status: 'pending', attempts: 0 }, ...queue]);

  return true;
}

export async function pending(limit = 10): Promise<QueueItem[]> {
  const queue = await readQueue();

  return queue
    .filter(row => row.status === 'pending')
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.at - right.at)
    .slice(0, limit);
}

export async function pendingCount(): Promise<number> {
  const queue = await readQueue();

  return queue.filter(row => row.status === 'pending').length;
}

export async function markDone(id: string, status: Exclude<QueueStatus, 'pending'>, hints: string[] = []): Promise<QueueItem | null> {
  const queue = await readQueue();
  const found = queue.find(row => row.id === id);
  if (found === undefined)
    return null;

  const next: QueueItem = { ...found, status, doneAt: Date.now(), hints };
  await writeQueue(queue.map(row => (row.id === id ? next : row)));

  return next;
}

export async function markFailed(id: string, reason: string): Promise<QueueItem | null> {
  const queue = await readQueue();
  const found = queue.find(row => row.id === id);
  if (found === undefined || found.status !== 'pending')
    return found ?? null;

  const attempts = (found.attempts ?? 0) + 1;
  const dropped = attempts >= MAX_ATTEMPTS;
  const next: QueueItem = {
    ...found,
    attempts,
    lastError: reason.slice(0, 200),
    status: dropped ? 'dropped' : 'pending',
    doneAt: dropped ? Date.now() : found.doneAt,
  };
  await writeQueue(queue.map(row => (row.id === id ? next : row)));

  return next;
}

export type OutcomeChange = { item: QueueItem; before: Outcome | null };

export async function applyOutcomes(rows: { id: string; outcome: Outcome; at: number }[]): Promise<OutcomeChange[]> {
  const queue = await readQueue();
  const byId = new Map(rows.map(row => [row.id, row]));
  const changes: OutcomeChange[] = [];
  const next = queue.map((item) => {
    const row = byId.get(item.id);
    if (row === undefined || item.outcome === row.outcome)
      return item;

    const updated: QueueItem = {
      ...item,
      status: item.status === 'pending' ? 'sent' : item.status,
      doneAt: item.status === 'pending' ? row.at : item.doneAt,
      outcome: row.outcome,
      outcomeAt: row.at,
    };
    changes.push({ item: updated, before: item.outcome ?? null });

    return updated;
  });
  if (changes.length > 0)
    await writeQueue(next);

  return changes;
}

function isItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null)
    return false;

  const row = value as Partial<QueueItem>;
  const outcomeOk = row.outcome === undefined || OUTCOMES.includes(row.outcome);

  return typeof row.id === 'string'
    && typeof row.company === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
    && typeof row.reason === 'string'
    && typeof row.at === 'number'
    && STATUSES.includes(row.status as QueueStatus)
    && outcomeOk;
}

import { storePath } from './memory.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type QueueStatus = 'pending' | 'sent' | 'needsHuman';

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
};

const MAX = 300;

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

  await writeQueue([{ ...item, at: Date.now(), status: 'pending' }, ...queue]);

  return true;
}

export async function pending(limit = 10): Promise<QueueItem[]> {
  const queue = await readQueue();

  return queue.filter(row => row.status === 'pending').slice(-limit).reverse();
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

function isItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null)
    return false;

  const row = value as Partial<QueueItem>;
  const statusOk = row.status === 'pending' || row.status === 'sent' || row.status === 'needsHuman';

  return typeof row.id === 'string'
    && typeof row.company === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
    && typeof row.reason === 'string'
    && typeof row.at === 'number'
    && statusOk;
}

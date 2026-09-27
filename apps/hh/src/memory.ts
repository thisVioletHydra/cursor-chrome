import { SEND_PER_DAY, WORK_FROM_HOUR, WORK_TO_HOUR } from './limits.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type Memory = {
  seen: string[];
  day: string;
  sent: number;
};

export function storePath(): string {
  if (process.env.HH_STORE)
    return process.env.HH_STORE;

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data/seen.json';

  return path.join(process.cwd(), 'data', 'seen.json');
}

export function moscowDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function readMemory(): Promise<Memory> {
  const day = moscowDay();
  let text: string;
  try {
    text = await fsPromises.readFile(storePath(), 'utf8');
  }
  catch {
    return { seen: [], day, sent: 0 };
  }

  const parsed = parseJsonLoose(text);
  const raw = parsed && typeof parsed.value === 'object' && parsed.value !== null ? parsed.value as Partial<Memory> : {};
  const seen = Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === 'string') : [];
  if (raw.day !== day)
    return { seen, day, sent: 0 };

  return { seen, day, sent: typeof raw.sent === 'number' ? raw.sent : 0 };
}

export async function writeMemory(memory: Memory): Promise<void> {
  await writeJsonAtomic(storePath(), memory);
}

export function moscowHour(now = new Date()): number {
  const text = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23' }).format(now);

  return Number(text);
}

export function workHours(now = new Date()): boolean {
  const hour = moscowHour(now);

  return hour >= WORK_FROM_HOUR && hour < WORK_TO_HOUR;
}

export function dayOpen(memory: Memory): boolean {
  return memory.sent < SEND_PER_DAY;
}

export function roomToday(memory: Memory, pendingCount: number): boolean {
  return memory.sent + pendingCount < SEND_PER_DAY;
}

export function countSent(memory: Memory): Memory {
  return { ...memory, sent: memory.sent + 1 };
}

export function remember(memory: Memory, ...ids: string[]): Memory {
  const fresh = ids.filter(id => memory.seen.includes(id) === false);
  if (fresh.length === 0)
    return memory;

  return { ...memory, seen: [...memory.seen, ...fresh] };
}

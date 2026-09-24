import { SEND_PER_DAY } from './limits.ts';

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
  try {
    const raw = JSON.parse(await fsPromises.readFile(storePath(), 'utf8')) as Memory;
    const day = moscowDay();
    if (raw.day !== day)
      return { seen: raw.seen ?? [], day, sent: 0 };

    return { seen: raw.seen ?? [], day, sent: raw.sent ?? 0 };
  }
  catch {
    return { seen: [], day: moscowDay(), sent: 0 };
  }
}

export async function writeMemory(memory: Memory): Promise<void> {
  const file = storePath();
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify(memory));
}

export function canSend(memory: Memory, sentThisStart: number, perStart: number): boolean {
  return sentThisStart < perStart && memory.sent < SEND_PER_DAY;
}

export function remember(memory: Memory, id: string, sent: boolean): Memory {
  const seen = memory.seen.includes(id) ? memory.seen : [...memory.seen, id];
  return {
    seen,
    day: memory.day,
    sent: sent ? memory.sent + 1 : memory.sent,
  };
}

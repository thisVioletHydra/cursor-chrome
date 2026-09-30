import { SEND_PER_DAY, WORK_FROM_HOUR, WORK_TO_HOUR } from './limits.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SWAY = 0.16;
const DAY_LOW = Math.floor(SEND_PER_DAY * (1 - SWAY));
const DAY_HIGH = Math.ceil(SEND_PER_DAY * (1 + SWAY));

export type Memory = {
  seen: string[];
  day: string;
  sent: number;
  cap: number;
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

let tail: Promise<void> = Promise.resolve();

export function readMemory(): Promise<Memory> {
  return turn(loadMemory);
}

export function writeMemory(memory: Memory): Promise<void> {
  return turn(() => save(memory));
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
  return memory.sent < memory.cap;
}

export function roomToday(memory: Memory, pendingCount: number): boolean {
  return memory.sent + pendingCount < memory.cap;
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

export function diaryIds(seen: readonly string[], queued: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const id of seen) {
    if (/^\d+$/.test(id))
      ids.add(id);
  }

  for (const id of queued) {
    if (/^\d+$/.test(id))
      ids.add(id);
  }

  return [...ids];
}

function turn<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job);
  tail = run.then(() => undefined, () => undefined);

  return run;
}

async function loadMemory(): Promise<Memory> {
  const day = moscowDay();
  const raw = await readRaw();
  const seen = Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === 'string') : [];
  const sameDay = raw.day === day;
  const sent = sameDay && typeof raw.sent === 'number' ? raw.sent : 0;
  const kept = sameDay ? capOf(raw.cap) : null;
  if (kept !== null)
    return { seen, day, sent, cap: kept };

  const memory = { seen, day, sent, cap: drawDayCap() };
  await save(memory);

  return memory;
}

async function readRaw(): Promise<Partial<Memory>> {
  let text: string;
  try {
    text = await fsPromises.readFile(storePath(), 'utf8');
  }
  catch {
    return {};
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null || typeof parsed.value !== 'object' || parsed.value === null)
    return {};

  return parsed.value as Partial<Memory>;
}

async function save(memory: Memory): Promise<void> {
  await writeJsonAtomic(storePath(), memory);
}

function drawDayCap(): number {
  const whole = Math.round(sway(SEND_PER_DAY));
  if (whole < DAY_LOW)
    return DAY_LOW;

  if (whole > DAY_HIGH)
    return DAY_HIGH;

  return whole;
}

function sway(base: number): number {
  const p = Math.random() * (SWAY * 2) - SWAY;

  return base * (1 + Math.min(SWAY, Math.max(-SWAY, p)));
}

function capOf(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isInteger(value) === false)
    return null;

  if (value < DAY_LOW || value > DAY_HIGH)
    return null;

  return value;
}

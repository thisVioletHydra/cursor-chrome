import { clearLinks, deleteLinks, insertLinks, listLinks, lookupHeld } from './links-db.ts';
import { SEND_PER_DAY, WORK_FROM_HOUR, WORK_TO_HOUR } from '../limits.ts';
import { bumpDay, clearSearchPages, countHidden, countPassed, countSeen, insertHidden, insertSeen, listPassed, lookupSeen, openStore, readDay, readSearchPages, savePassed, storePath, writeDay, writeSearchPage } from './seen-db.ts';
import type { PassedNote, PassedRow } from './seen-db.ts';

export type { PassedNote, PassedRow };
export { HIDE_REASON } from './seen-db.ts';

export type { HeldLink } from './links-db.ts';

const SWAY = 0.16;
const DAY_LOW = Math.floor(SEND_PER_DAY * (1 - SWAY));
const DAY_HIGH = Math.ceil(SEND_PER_DAY * (1 + SWAY));

export type Memory = {
  day: string;
  sent: number;
  cap: number;
};

export { storePath };

export function moscowDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function readMemory(): Promise<Memory> {
  return turn(async () => loadDay());
}

export function remember(ids: readonly string[]): Promise<void> {
  return turn(() => insertSeen(ids, Date.now()));
}

export function noteHidden(ids: readonly string[]): Promise<void> {
  return turn(() => insertHidden(ids, Date.now()));
}

export function notePassed(rows: readonly PassedNote[]): Promise<void> {
  return turn(async () => {
    savePassed(rows);
  });
}

export function readPassed(limit = 80): Promise<PassedRow[]> {
  return turn(async () => listPassed(limit));
}

export function markSent(id: string): Promise<void> {
  return turn(() => noteSent(id));
}

export function knownAmong(ids: readonly string[]): Promise<string[]> {
  return turn(async () => lookupSeen(ids));
}

export function seenCount(): Promise<number> {
  return turn(async () => countSeen());
}

export function hiddenCount(): Promise<number> {
  return turn(async () => countHidden());
}

export function passedCount(): Promise<number> {
  return turn(async () => countPassed());
}

export function heldAmong(ids: readonly string[]): Promise<string[]> {
  return turn(async () => lookupHeld(ids));
}

export function keepLinks(rows: readonly { id: string; url: string; title: string }[]): Promise<string[]> {
  return turn(async () => {
    const { busyAmong } = await import('../queue/queue.ts');
    const busy = new Set(await busyAmong(rows.map(row => row.id)));

    return insertLinks(rows.filter(row => busy.has(row.id) === false), Date.now());
  });
}

export function readLinks(limit: number): Promise<{ id: string; url: string; title: string }[]> {
  return turn(async () => listLinks(limit));
}

export function searchPages(queries: readonly string[]): Promise<Record<string, number>> {
  return turn(async () => readSearchPages(queries));
}

export function rememberSearchPage(query: string, page: number): Promise<void> {
  return turn(async () => {
    writeSearchPage(query, page);
  });
}

export function forgetSearchPages(queries: readonly string[]): Promise<void> {
  return turn(async () => {
    clearSearchPages(queries);
  });
}

export function forgetLinks(ids: readonly string[]): Promise<void> {
  return turn(async () => {
    deleteLinks(ids);
  });
}

export function forgetAllLinks(): Promise<void> {
  return turn(async () => {
    clearLinks();
  });
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

let booted = false;
let tail: Promise<void> = Promise.resolve();

function turn<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(() => runJob(job));
  tail = run.then(() => undefined, () => undefined);

  return run;
}

async function runJob<T>(job: () => Promise<T>): Promise<T> {
  if (booted === false)
    await boot();

  return job();
}

async function boot(): Promise<void> {
  await openStore();
  booted = true;
}

async function noteSent(id: string): Promise<void> {
  await insertSeen([id], Date.now());
  const memory = loadDay();
  bumpDay(memory.day);
}

function loadDay(): Memory {
  const day = moscowDay();
  const kept = readDay(day);
  if (kept !== null)
    return { day, sent: kept.sent, cap: kept.cap };

  const memory = { day, sent: 0, cap: drawDayCap() };
  writeDay(memory.day, memory.cap, memory.sent);

  return memory;
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
  const picked = Math.random() * (SWAY * 2) - SWAY;

  return base * (1 + Math.min(SWAY, Math.max(-SWAY, picked)));
}

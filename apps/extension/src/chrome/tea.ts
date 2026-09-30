import { tickPage } from './page-log';
import { waitMs } from './pace';
import { browser } from '../browser-host';

const SWAY = 0.16;
const TEA_EVERY_MS = 45 * 60 * 1000;
const TEA_HIT = 0.33;
const TEA_MISS_MS = 15_000;
const TEA_MIN_SEC = 300;
const TEA_MAX_SEC = 600;
const TEA_RUN_KEY = 'teaRun';
const TEA_NEED_KEY = 'teaNeed';
const TEA_SEEN_KEY = 'teaSeen';
const TEA_AT_KEY = 'teaAt';
const TEA_DUE_KEY = 'teaDue';
const FLAGS_KEY = 'flags';
// Keepalive раз в секунду. Дырка длиннее — воркер спал или бот не работал, в срок чая это не входит.
const BLIP_MS = 15_000;
const FLUSH_MS = 5_000;

type TeaClock = {
  run: number;
  need: number;
  seen: number;
};

type TeaRoll = {
  hit: boolean;
  pause: number;
  need: number;
  stamp: number;
};

let clock: TeaClock | null = null;
let holdUntil = 0;
let flushedAt = 0;
let epoch = 0;
let working = false;
let woke = false;
let beatChain: Promise<void> = Promise.resolve();

export function markTeaWork(on: boolean): void {
  working = on;
}

export async function resetTeaClock(): Promise<void> {
  await enqueue(async () => {
    const now = Date.now();
    epoch += 1;
    woke = true;
    holdUntil = 0;
    clock = opened(now);
    await persist(clock, now);
    await dropWallClock();
  });
}

export async function clearTeaClock(): Promise<void> {
  await enqueue(async () => {
    epoch += 1;
    woke = true;
    holdUntil = 0;
    clock = null;
    flushedAt = 0;
    await browser.storage.local.remove([TEA_RUN_KEY, TEA_NEED_KEY, TEA_SEEN_KEY, TEA_AT_KEY, TEA_DUE_KEY]);
  });
}

export async function noteTeaSession(): Promise<void> {
  if (await botOn() === false)
    return;

  await enqueue(async () => {
    await settle(Date.now());
  });
}

export async function maybeTea(): Promise<void> {
  const roll = await enqueue(() => planTea(Date.now()));
  if (roll === null)
    return;

  // `чай N` и `жду N` каждую секунду, иначе сторож решит, что бот завис.
  await tickPage(roll.hit ? 'чай' : 'жду', roll.pause);
  await enqueue(() => finishTea(roll));
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = beatChain.then(work, work);
  beatChain = run.then(() => undefined, () => undefined);

  return run;
}

async function planTea(now: number): Promise<TeaRoll | null> {
  if (await botOn() === false)
    return null;

  const live = await settle(now);
  if (woke || live.run < live.need)
    return null;

  const hit = Math.random() < TEA_HIT;
  const pause = hit ? waitMs(TEA_MIN_SEC, TEA_MAX_SEC) : swayMs(TEA_MISS_MS);
  const need = swayMs(TEA_EVERY_MS);
  holdUntil = now + pause;
  clock = { run: 0, need, seen: now };
  await persist(clock, now);

  return { hit, pause, need, stamp: epoch };
}

async function finishTea(roll: TeaRoll): Promise<void> {
  if (roll.stamp !== epoch || await botOn() === false)
    return;

  const now = Date.now();
  holdUntil = 0;
  clock = { run: 0, need: roll.need, seen: now };
  await persist(clock, now);
}

async function onBeat(now: number): Promise<void> {
  if (working === false || await botOn() === false)
    return;

  if (now < holdUntil)
    return;

  await settle(now);
}

async function settle(now: number): Promise<TeaClock> {
  if (clock === null)
    clock = await readClock();

  clock = accrue(clock, now);
  if (now - flushedAt >= FLUSH_MS)
    await persist(clock, now);

  return clock;
}

function accrue(prev: TeaClock, now: number): TeaClock {
  if (prev.need <= 0 || prev.seen <= 0) {
    woke = true;

    return opened(now);
  }

  const gap = now - prev.seen;
  if (gap <= 0)
    return prev;

  if (gap > BLIP_MS) {
    woke = true;

    return { run: prev.run, need: prev.need, seen: now };
  }

  woke = false;

  return { run: prev.run + gap, need: prev.need, seen: now };
}

function opened(now: number): TeaClock {
  return { run: 0, need: swayMs(TEA_EVERY_MS), seen: now };
}

async function persist(next: TeaClock, now: number): Promise<void> {
  flushedAt = now;
  await browser.storage.local.set({
    [TEA_RUN_KEY]: next.run,
    [TEA_NEED_KEY]: next.need,
    [TEA_SEEN_KEY]: next.seen,
  });
}

async function dropWallClock(): Promise<void> {
  await browser.storage.local.remove([TEA_AT_KEY, TEA_DUE_KEY]);
}

async function readClock(): Promise<TeaClock> {
  const stored = await browser.storage.local.get([TEA_RUN_KEY, TEA_NEED_KEY, TEA_SEEN_KEY]);
  const need = needOf(stored[TEA_NEED_KEY]);
  if (need <= 0) {
    await dropWallClock();

    return { run: 0, need: 0, seen: 0 };
  }

  return {
    run: runOf(stored[TEA_RUN_KEY], need),
    need,
    seen: stampOf(stored[TEA_SEEN_KEY]),
  };
}

function needOf(value: unknown): number {
  const need = stampOf(value);
  const min = Math.floor(TEA_EVERY_MS * (1 - SWAY));
  const max = Math.ceil(TEA_EVERY_MS * (1 + SWAY));
  if (need < min || need > max)
    return 0;

  return need;
}

function runOf(value: unknown, need: number): number {
  const run = stampOf(value);
  if (run <= 0 || run > need + TEA_EVERY_MS)
    return 0;

  return run;
}

async function botOn(): Promise<boolean> {
  const stored = await browser.storage.local.get(FLAGS_KEY);
  const raw = stored[FLAGS_KEY];
  if (typeof raw !== 'object' || raw === null)
    return false;

  return 'autoQueue' in raw && raw.autoQueue === true;
}

function sway(base: number): number {
  const span = Math.random() * (SWAY * 2) - SWAY;

  return base * (1 + Math.min(SWAY, Math.max(-SWAY, span)));
}

function swayMs(base: number): number {
  return Math.round(sway(base));
}

function stampOf(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false)
    return 0;

  return value;
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive')
    return;

  port.onMessage.addListener(() => {
    void enqueue(() => onBeat(Date.now()));
  });
});

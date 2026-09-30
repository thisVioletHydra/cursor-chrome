import { tickPage } from './page-log';
import { waitMs } from './pace';
import { browser } from '../browser-host';

const SWAY = 0.16;
const TEA_EVERY_MS = 45 * 60 * 1000;
const TEA_HIT = 0.33;
const TEA_MISS_MS = 15_000;
const TEA_MIN_SEC = 300;
const TEA_MAX_SEC = 600;
const TEA_AT_KEY = 'teaAt';
const TEA_SEEN_KEY = 'teaSeen';
const TEA_DUE_KEY = 'teaDue';

type TeaClock = {
  at: number;
  seen: number;
  due: number;
};

export async function noteTeaSession(): Promise<void> {
  const now = Date.now();
  const clock = await readClock();
  if (await kept(clock, now))
    return;

  await arm(now);
}

export async function maybeTea(): Promise<void> {
  const now = Date.now();
  const clock = await readClock();
  const due = clock.due !== 0 ? clock.due : swayMs(TEA_EVERY_MS) + (clock.at === 0 ? now : clock.at);
  if (now < due) {
    await browser.storage.local.set({
      [TEA_AT_KEY]: clock.at === 0 ? now : clock.at,
      [TEA_SEEN_KEY]: now,
      [TEA_DUE_KEY]: due,
    });

    return;
  }

  const hit = Math.random() < TEA_HIT;
  const pause = hit ? waitMs(TEA_MIN_SEC, TEA_MAX_SEC) : swayMs(TEA_MISS_MS);
  const next = swayMs(TEA_EVERY_MS);
  await browser.storage.local.set({
    [TEA_AT_KEY]: now,
    [TEA_SEEN_KEY]: now,
    [TEA_DUE_KEY]: now + pause + next,
  });
  // `чай N` и `жду N` каждую секунду, иначе сторож решит, что бот завис.
  await tickPage(hit ? 'чай' : 'жду', pause);
}

async function kept(clock: TeaClock, now: number): Promise<boolean> {
  if (clock.seen === 0)
    return false;

  const start = clock.at === 0 ? clock.seen : clock.at;
  const due = clock.due !== 0 ? clock.due : start + swayMs(TEA_EVERY_MS);
  if (now - clock.seen >= due - start)
    return false;

  if (clock.due === 0) {
    await browser.storage.local.set({
      [TEA_AT_KEY]: start,
      [TEA_SEEN_KEY]: now,
      [TEA_DUE_KEY]: due,
    });
  }

  return true;
}

function sway(base: number): number {
  const p = Math.random() * (SWAY * 2) - SWAY;

  return base * (1 + Math.min(SWAY, Math.max(-SWAY, p)));
}

function swayMs(base: number): number {
  return Math.round(sway(base));
}

async function readClock(): Promise<TeaClock> {
  const stored = await browser.storage.local.get([TEA_AT_KEY, TEA_SEEN_KEY, TEA_DUE_KEY]);

  return {
    at: stampOf(stored[TEA_AT_KEY]),
    seen: stampOf(stored[TEA_SEEN_KEY]),
    due: stampOf(stored[TEA_DUE_KEY]),
  };
}

async function arm(now: number): Promise<void> {
  await browser.storage.local.set({
    [TEA_AT_KEY]: now,
    [TEA_SEEN_KEY]: now,
    [TEA_DUE_KEY]: now + swayMs(TEA_EVERY_MS),
  });
}

function stampOf(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false)
    return 0;

  return value;
}

import { browser } from '../browser-host';

export type Pace = {
  readMin: number;
  readMax: number;
  distractMin: number;
  distractMax: number;
  fastEvery: number;
  fastMin: number;
  fastMax: number;
};

const PACE_KEY = 'imitationPace';
const SEC_MAX = 600;
const EVERY_MAX = 100;

export const PACE_DEFAULT: Pace = {
  readMin: 10,
  readMax: 40,
  distractMin: 5,
  distractMax: 55,
  fastEvery: 12,
  fastMin: 1,
  fastMax: 4,
};

export async function rememberPace(raw: unknown): Promise<void> {
  await browser.storage.local.set({ [PACE_KEY]: paceOf(raw) });
}

export async function loadPace(): Promise<Pace> {
  const stored = await browser.storage.local.get(PACE_KEY);

  return paceOf(stored[PACE_KEY]);
}

export function rare(quota: number): boolean {
  if (quota < 1)
    return false;

  return Math.floor(Math.random() * quota) === 0;
}

export function waitMs(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);

  return (lo + Math.floor(Math.random() * (hi - lo + 1))) * 1000;
}

function paceOf(raw: unknown): Pace {
  const row = typeof raw === 'object' && raw !== null ? raw as Partial<Pace> : {};
  const pace: Pace = { ...PACE_DEFAULT };
  const ranges = [
    ['readMin', 'readMax'],
    ['distractMin', 'distractMax'],
    ['fastMin', 'fastMax'],
  ] as const;
  for (const [minKey, maxKey] of ranges) {
    const min = whole(row[minKey], 0, SEC_MAX);
    const max = whole(row[maxKey], 0, SEC_MAX);
    if (min === null || max === null || min > max)
      continue;

    pace[minKey] = min;
    pace[maxKey] = max;
  }

  const quota = whole(row.fastEvery, 1, EVERY_MAX);
  if (quota !== null)
    pace.fastEvery = quota;

  return pace;
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || Number.isInteger(value) === false)
    return null;

  if (value < min || value > max)
    return null;

  return value;
}

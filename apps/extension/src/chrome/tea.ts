import { tickPage } from './page-log';
import { waitMs } from './pace';
import { browser } from '../browser-host';

const TEA_GAP_MS = 45 * 60 * 1000;
const TEA_HIT = 0.33;
const TEA_MISS_MS = 15_000;
const TEA_MIN_SEC = 300;
const TEA_MAX_SEC = 600;
const TEA_AT_KEY = 'teaAt';
const TEA_SEEN_KEY = 'teaSeen';

export async function noteTeaSession(): Promise<void> {
  const now = Date.now();
  const stored = await browser.storage.local.get(TEA_SEEN_KEY);
  const seen = stampOf(stored[TEA_SEEN_KEY]);
  if (seen !== 0 && now - seen < TEA_GAP_MS)
    return;

  await browser.storage.local.set({ [TEA_AT_KEY]: now, [TEA_SEEN_KEY]: now });
}

export async function maybeTea(): Promise<void> {
  const now = Date.now();
  const stored = await browser.storage.local.get(TEA_AT_KEY);
  const marked = stampOf(stored[TEA_AT_KEY]);
  if (marked === 0 || now - marked < TEA_GAP_MS) {
    await browser.storage.local.set({
      [TEA_AT_KEY]: marked === 0 ? now : marked,
      [TEA_SEEN_KEY]: now,
    });

    return;
  }

  await browser.storage.local.set({ [TEA_AT_KEY]: now, [TEA_SEEN_KEY]: now });
  const hit = Math.random() < TEA_HIT;
  const pause = hit ? waitMs(TEA_MIN_SEC, TEA_MAX_SEC) : TEA_MISS_MS;
  // `чай N` и `жду N` каждую секунду, иначе сторож решит, что бот завис.
  await tickPage(hit ? 'чай' : 'жду', pause);
}

function stampOf(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false)
    return 0;

  return value;
}

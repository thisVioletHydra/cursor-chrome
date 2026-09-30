import { clearTeaClock, resetTeaClock } from './tea';
import { browser } from '../browser-host';

export type Flags = {
  hideJunk: boolean;
  keepSession: boolean;
  showPop: boolean;
  autoQueue: boolean;
};

const KEY = 'flags';
const DEFAULTS: Flags = { hideJunk: false, keepSession: false, showPop: true, autoQueue: false };

export async function getFlags(): Promise<Flags> {
  const stored = await browser.storage.local.get(KEY);
  const raw = stored[KEY];
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULTS };

  const row = raw as { hideJunk?: unknown; keepSession?: unknown; showPop?: unknown; autoQueue?: unknown };

  return {
    hideJunk: row.hideJunk === true,
    keepSession: row.keepSession === true,
    showPop: row.showPop !== false,
    autoQueue: row.autoQueue === true,
  };
}

export async function setFlags(patch: Partial<Flags>): Promise<Flags> {
  const prev = await getFlags();
  const next = { ...prev, ...patch };
  if (prev.autoQueue === false && next.autoQueue === true)
    await resetTeaClock();

  if (prev.autoQueue === true && next.autoQueue === false)
    await clearTeaClock();

  await browser.storage.local.set({ [KEY]: next });

  return next;
}

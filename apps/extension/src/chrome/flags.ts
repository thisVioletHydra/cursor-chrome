import { browser } from '../browser-host';

export type Flags = {
  hideJunk: boolean;
  keepSession: boolean;
  showPop: boolean;
};

const KEY = 'flags';
const DEFAULTS: Flags = { hideJunk: false, keepSession: false, showPop: true };

export async function getFlags(): Promise<Flags> {
  const stored = await browser.storage.local.get(KEY);
  const raw = stored[KEY];
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULTS };

  const row = raw as { hideJunk?: unknown; keepSession?: unknown; showPop?: unknown };

  return {
    hideJunk: row.hideJunk === true,
    keepSession: row.keepSession === true,
    showPop: row.showPop !== false,
  };
}

export async function setFlags(patch: Partial<Flags>): Promise<Flags> {
  const next = { ...await getFlags(), ...patch };
  await browser.storage.local.set({ [KEY]: next });

  return next;
}

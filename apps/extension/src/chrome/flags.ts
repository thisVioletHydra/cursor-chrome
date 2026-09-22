export type Flags = {
  hideJunk: boolean;
  keepSession: boolean;
};

const KEY = 'flags';
const DEFAULTS: Flags = { hideJunk: false, keepSession: false };

export async function getFlags(): Promise<Flags> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY];
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULTS };

  const row = raw as { hideJunk?: unknown; keepSession?: unknown };

  return {
    hideJunk: row.hideJunk === true,
    keepSession: row.keepSession === true,
  };
}

export async function setFlags(patch: Partial<Flags>): Promise<Flags> {
  const next = { ...await getFlags(), ...patch };
  await chrome.storage.local.set({ [KEY]: next });

  return next;
}

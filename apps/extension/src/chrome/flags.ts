export type Flags = {
  hideJunk: boolean;
};

const KEY = 'flags';

export async function getFlags(): Promise<Flags> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY];
  if (!raw || typeof raw !== 'object')
    return { hideJunk: false };

  return { hideJunk: (raw as { hideJunk?: unknown }).hideJunk === true };
}

export async function setFlags(patch: Partial<Flags>): Promise<Flags> {
  const next = { ...await getFlags(), ...patch };
  await chrome.storage.local.set({ [KEY]: next });

  return next;
}

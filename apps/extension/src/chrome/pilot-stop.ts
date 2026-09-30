import { browser } from '../browser-host';

const STOP_KEY = 'pilotStop';

export async function markPilotStop(): Promise<void> {
  const stored = await browser.storage.local.get(STOP_KEY);
  if (stored[STOP_KEY] === true)
    return;

  await browser.storage.local.set({ [STOP_KEY]: true });
}

export async function clearPilotStop(): Promise<void> {
  const stored = await browser.storage.local.get(STOP_KEY);
  if (stored[STOP_KEY] !== true)
    return;

  await browser.storage.local.remove(STOP_KEY);
}

export async function pilotStopped(): Promise<boolean> {
  const stored = await browser.storage.local.get(STOP_KEY);

  return stored[STOP_KEY] === true;
}

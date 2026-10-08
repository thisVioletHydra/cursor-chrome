import { browser } from '../browser-host';

const KEY = 'formHold';
const HELD_ON = 'formHoldVersion';

export const FORM_STUCK = 'форма отклика зависла';
export const FORM_PAUSE_LINE = 'queue-run.ts · форма отклика зависла, бот на паузе. сними шаблон';

export async function formHeld(): Promise<boolean> {
  const stored = await browser.storage.local.get(KEY);

  return stored[KEY] === true;
}

export async function holdForm(): Promise<void> {
  await browser.storage.local.set({
    [KEY]: true,
    [HELD_ON]: browser.runtime.getManifest().version,
  });
}

export async function clearFormHold(): Promise<void> {
  await browser.storage.local.remove([KEY, HELD_ON]);
}

export async function releaseStaleHold(): Promise<boolean> {
  const stored = await browser.storage.local.get([KEY, HELD_ON]);
  if (stored[KEY] !== true)
    return false;

  const heldOn = typeof stored[HELD_ON] === 'string' ? stored[HELD_ON] : '';
  if (heldOn === browser.runtime.getManifest().version)
    return false;

  await clearFormHold();

  return true;
}

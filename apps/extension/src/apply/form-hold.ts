import { browser } from '../browser-host';

const KEY = 'formHold';

export const FORM_STUCK = 'форма отклика зависла';
export const FORM_PAUSE_LINE = 'queue-run.ts · форма отклика зависла, бот на паузе. сними шаблон';

export async function formHeld(): Promise<boolean> {
  const stored = await browser.storage.local.get(KEY);

  return stored[KEY] === true;
}

export async function holdForm(): Promise<void> {
  await browser.storage.local.set({ [KEY]: true });
}

export async function clearFormHold(): Promise<void> {
  await browser.storage.local.remove(KEY);
}

import type { Flags } from './flags';

import { getFlags, setFlags } from './flags';
import { clearPilotPending, readPilotPending, setPilotPending } from './pilot-link';
import { pilotStopped } from './pilot-stop';
import { checkWorker, closePinnedHh, isBotWorkUrl, openingTab } from './worker-tab';
import { browser } from '../browser-host';

const CAPTCHA_HOLD = 'captchaHold';
const PAUSED_KEY = 'pausedUntil';

export async function reconcilePilot(): Promise<Flags> {
  const flags = await getFlags();
  if (flags.autoQueue === true || openingTab())
    return flags;

  if (await botSearchPinned() === false) {
    if (openingTab() || (await getFlags()).autoQueue === true)
      return getFlags();

    const check = await checkWorker();
    if (check.ok === true && openingTab() === false)
      await closePinnedHh();

    return getFlags();
  }

  if (await keepOff()) {
    if (openingTab() || (await getFlags()).autoQueue === true)
      return getFlags();

    await closePinnedHh();

    return getFlags();
  }

  await setPilotPending('on');
  const next = await setFlags({ autoQueue: true });
  if (next.autoQueue !== true && (await readPilotPending()) === 'on')
    await clearPilotPending();

  return next;
}

async function botSearchPinned(): Promise<boolean> {
  const check = await checkWorker();

  return check.ok === true && typeof check.url === 'string' && isBotWorkUrl(check.url);
}

async function keepOff(): Promise<boolean> {
  if (await pilotStopped())
    return true;

  if ((await readPilotPending()) === 'off')
    return true;

  const stored = await browser.storage.local.get([CAPTCHA_HOLD, PAUSED_KEY]);
  if (stored[CAPTCHA_HOLD] === true)
    return true;

  const until = stored[PAUSED_KEY];

  return typeof until === 'number' && until > Date.now();
}

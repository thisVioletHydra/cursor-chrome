import type { Flags } from './flags';

import { getFlags } from './flags';
import { applyPilot } from './pilot-apply';
import { clearPilotPending, readPilotPending, setPilotPending } from './pilot-link';
import { pilotStopped } from './pilot-stop';
import { checkWorker, isBotWorkUrl, openingTab } from './worker-tab';
import { browser } from '../browser-host';

const CAPTCHA_HOLD = 'captchaHold';
const PAUSED_KEY = 'pausedUntil';

export async function reconcilePilot(): Promise<Flags> {
  if (openingTab())
    return getFlags();

  const flags = await getFlags();
  const botTab = flags.autoQueue === true ? false : await botSearchPinned();
  const explicitStop = flags.autoQueue === true ? false : await keepOff();
  if (explicitStop === false && botTab && flags.autoQueue === false)
    await setPilotPending('on');

  const decided = await applyPilot({ type: 'pair', botTab, explicitStop });
  if (await healRefused(decided.on, flags.autoQueue))
    await clearPilotPending();

  return getFlags();
}

async function healRefused(turnedOn: boolean, wasOn: boolean): Promise<boolean> {
  if (turnedOn === false || wasOn)
    return false;

  if ((await readPilotPending()) !== 'on')
    return false;

  const stored = await getFlags();

  return stored.autoQueue !== true;
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

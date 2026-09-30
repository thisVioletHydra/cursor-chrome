import type { Flags } from './flags';

import { getFlags } from './flags';
import { applyPilot } from './pilot-apply';
import { clearPilotPending, readPilotPending, setPilotPending } from './pilot-link';
import { pilotStopped } from './pilot-stop';
import { checkWorker, isBotWorkUrl, openingTab } from '../tab/worker-tab';
import { browser } from '../browser-host';

const CAPTCHA_HOLD = 'captchaHold';
const PAUSED_KEY = 'pausedUntil';

export async function reconcilePilot(): Promise<Flags> {
  if (openingTab())
    return getFlags();

  const flags = await getFlags();
  const botTab = flags.autoQueue === true ? false : await botSearchPinned();
  const explicitStop = flags.autoQueue === true ? false : await keepOff();
  const arm = explicitStop === false && botTab && flags.autoQueue === false;
  if (arm)
    await setPilotPending('on');

  await applyPilot({ type: 'pair', botTab, explicitStop });
  if (arm && (await getFlags()).autoQueue !== true)
    await clearPilotPending();

  return getFlags();
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

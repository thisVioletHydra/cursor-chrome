import { clearPilotStop, pilotStopped } from './pilot-stop';
import { clearTeaClock, resetTeaClock } from '../apply/tea-clock';
import { openingTab } from '../tab/worker-tab';
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
  const turningOn = prev.autoQueue === false && next.autoQueue === true;
  const turningOff = prev.autoQueue === true && next.autoQueue === false;
  if (turningOff && openingTab())
    return prev;

  if (turningOn)
    await resetTeaClock();

  if (turningOff)
    await clearTeaClock();

  const live = await getFlags();
  if (turningOn && live.autoQueue === false && await pilotStopped())
    return live;

  if ((turningOn && live.autoQueue === true) || (turningOff && live.autoQueue === false))
    return live;

  const stored = { ...live, ...patch };
  if (stored.autoQueue === true && live.autoQueue === false)
    await clearPilotStop();

  await browser.storage.local.set({ [KEY]: stored });

  return stored;
}

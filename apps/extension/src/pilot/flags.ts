import { clearPilotStop, pilotStopped } from './pilot-stop';
import { clearTeaClock, resetTeaClock } from '../apply/tea-clock';
import { openingTab } from '../tab/worker-tab';
import { browser } from '../browser-host';
import { waitUntil } from './power-queue.ts';
import { userWishOff } from './power-wish';
import { adminSettingsOf, EXT_CONFIG_KEY, localPatch, mergeSettings } from './ext-settings';

export type Flags = {
  hideJunk: boolean;
  keepSession: boolean;
  showPop: boolean;
  showMachine: boolean;
  autoQueue: boolean;
};

const KEY = 'flags';
const DEFAULTS: Flags = { hideJunk: false, keepSession: false, showPop: true, showMachine: false, autoQueue: false };

// effective flags: admin value (extConfig:v1 cache) wins, else the local one
export async function getFlags(): Promise<Flags> {
  const stored = await browser.storage.local.get([KEY, EXT_CONFIG_KEY]);
  return mergeSettings(localOf(stored[KEY]), adminSettingsOf(stored));
}

export async function adminManaged() {
  return adminSettingsOf(await browser.storage.local.get(EXT_CONFIG_KEY));
}

async function getLocalFlags(): Promise<Flags> {
  const stored = await browser.storage.local.get(KEY);
  return localOf(stored[KEY]);
}

function localOf(raw: unknown): Flags {
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULTS };

  const row = raw as { hideJunk?: unknown; keepSession?: unknown; showPop?: unknown; showMachine?: unknown; autoQueue?: unknown };

  return {
    hideJunk: row.hideJunk === true,
    keepSession: row.keepSession === true,
    showPop: row.showPop !== false,
    showMachine: row.showMachine === true,
    autoQueue: row.autoQueue === true,
  };
}

export async function setFlags(asked: Partial<Flags>, opts: { user?: boolean } = {}): Promise<Flags> {
  const patch = localPatch(asked, await adminManaged());
  const prev = await getFlags();
  const next = { ...prev, ...patch };
  const turningOn = prev.autoQueue === false && next.autoQueue === true;
  const turningOff = prev.autoQueue === true && next.autoQueue === false;
  // the bot tab is still opening (fast on→off): wait for it instead of silently keeping the pilot on
  // a user «off» never waits: it is written at once, the opening tab is closed by the stop step
  if (turningOff && opts.user !== true && openingTab() && await waitUntil(() => openingTab() === false, 8000) === false)
    return prev;

  if (turningOn)
    await resetTeaClock();

  if (turningOff)
    await clearTeaClock();

  if (turningOn || turningOff)
    await browser.storage.local.remove(['feedLight', 'feedLightUntil', 'feedMode', 'feedWord']);

  const live = await getFlags();
  if (turningOn && live.autoQueue === false && await pilotStopped())
    return live;

  if ((turningOn && live.autoQueue === true) || (turningOff && live.autoQueue === false))
    return live;

  const stored = { ...(await getLocalFlags()), ...patch };
  // checked synchronously right before the write: after a user «off» nothing may revive the pilot
  if (stored.autoQueue === true && live.autoQueue === false && userWishOff())
    return live;

  if (stored.autoQueue === true && live.autoQueue === false)
    await clearPilotStop();

  await browser.storage.local.set({ [KEY]: stored });

  return getFlags();
}

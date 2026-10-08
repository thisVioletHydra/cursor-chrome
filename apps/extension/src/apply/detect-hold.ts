import { browser } from '../browser-host';
import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { DETECT_LINE } from '../hh/detect-wall';
import { tellPage } from '../pilot/page-log';
import { applyPilot } from '../pilot/pilot-apply';
import { markPilotStop } from '../pilot/pilot-stop';
import { pinnedDetect } from '../tab/hh-detect';

const KEY = 'detectHold';
const NOTE = 'detectNote';

export async function detectHolding(): Promise<boolean> {
  const stored = await browser.storage.local.get(KEY);

  return stored[KEY] === true;
}

export async function clearDetectHold(): Promise<void> {
  await browser.storage.local.remove([KEY, NOTE]);
}

export async function guardDetect(): Promise<boolean> {
  if (await pinnedDetect()) {
    await holdDetect();

    return true;
  }

  if (await detectHolding())
    await clearDetectHold();

  return false;
}

export async function holdDetect(): Promise<void> {
  await tellPage(DETECT_LINE);
  await markPilotStop();
  await applyPilot({ type: 'stop', reason: 'alarm' });
  await browser.storage.local.set({ [KEY]: true });
  await postAlarm();
}

async function postAlarm(): Promise<void> {
  const stored = await browser.storage.local.get(NOTE);
  if (stored[NOTE] === 'sent')
    return;

  const base = await syncBase();
  const key = await getSyncKey();
  if (base.length === 0 || key.length === 0)
    return;

  try {
    const res = await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: '0', status: 'stop', alarm: true }),
    });
    if (res.ok)
      await browser.storage.local.set({ [NOTE]: 'sent' });
  }
  catch {
    return;
  }
}

async function syncBase(): Promise<string> {
  const raw = (await getSyncUrl()).trim();
  if (raw.length === 0)
    return '';

  try {
    const url = new URL(raw);

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

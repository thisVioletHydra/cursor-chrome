import { getWorkerTabId } from './worker-tab';
import { hhCaptchaShown } from '../hh/captcha';
import { browser } from '../browser-host';

export async function pinnedCaptcha(): Promise<boolean | null> {
  const tabId = await getWorkerTabId();
  if (tabId === null)
    return false;

  return readCaptcha(tabId);
}

export async function tabShowsCaptcha(tabId: number): Promise<boolean> {
  return (await readCaptcha(tabId)) === true;
}

async function readCaptcha(tabId: number): Promise<boolean | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab === null)
    return false;

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: hhCaptchaShown,
    });

    return results[0]?.result === true;
  }
  catch {
    return null;
  }
}

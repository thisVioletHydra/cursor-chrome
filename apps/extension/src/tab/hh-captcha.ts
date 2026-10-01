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

  if (tab.discarded === true || tab.frozen === true)
    return false;

  try {
    const results = await raceScript(browser.scripting.executeScript({
      target: { tabId },
      func: hhCaptchaShown,
    }), 8_000);

    return results?.[0]?.result === true;
  }
  catch {
    return null;
  }
}

function raceScript<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

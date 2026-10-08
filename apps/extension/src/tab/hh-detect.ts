import { browser } from '../browser-host';
import { hhDetectShown } from '../hh/detect-wall';
import { getWorkerTabId } from './worker-tab';

export async function tabShowsDetect(tabId: number): Promise<boolean> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab === null)
    return false;

  if (tab.discarded === true || tab.frozen === true)
    return false;

  try {
    const results = await raceScript(browser.scripting.executeScript({
      target: { tabId },
      func: hhDetectShown,
    }), 8_000);

    return results?.[0]?.result === true;
  }
  catch {
    return false;
  }
}

export async function pinnedDetect(): Promise<boolean> {
  const tabId = await getWorkerTabId();
  if (tabId === null)
    return false;

  return tabShowsDetect(tabId);
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

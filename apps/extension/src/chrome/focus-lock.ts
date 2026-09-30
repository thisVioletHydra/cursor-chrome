import { freshPilot, pilotStep } from './pilot';
import { browser } from '../browser-host';

type Hold = {
  tabId: number;
  windowId: number;
  windowFocused: boolean;
};

let hold: Hold | null = null;
const spawned = new Set<number>();
let installed = false;
let spare = false;

export function spareFocus(on: boolean): void {
  spare = on;
}

export function installFocusLock(): void {
  if (installed)
    return;

  installed = true;
  browser.tabs.onCreated.addListener((tab) => {
    if (spare || hold === null || typeof tab.id !== 'number')
      return;

    spawned.add(tab.id);
    if (tab.active)
      void browser.tabs.update(tab.id, { active: false }).catch(() => {});
  });
  browser.tabs.onActivated.addListener((info) => {
    const locked = hold;
    if (spare || locked === null || locked.windowFocused === false)
      return;

    if (info.tabId === locked.tabId)
      return;

    void browser.tabs.update(locked.tabId, { active: true }).catch(() => {});
  });
}

export async function snapshotFocus(): Promise<Hold | null> {
  const [focused] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (typeof focused?.id !== 'number')
    return null;

  const win = await browser.windows.get(focused.windowId);

  return {
    tabId: focused.id,
    windowId: focused.windowId,
    windowFocused: win.focused === true,
  };
}

export async function restoreFocus(prev: Hold | null): Promise<void> {
  const decided = pilotStep({ ...freshPilot(), on: true }, { type: 'touch', action: 'restore' });
  if (decided.closeBotTab || decided.on === false)
    return;

  if (prev === null)
    return;

  try {
    if (prev.windowFocused) {
      await browser.tabs.update(prev.tabId, { active: true });

      return;
    }

    await browser.windows.update(prev.windowId, { focused: false });
  }
  catch {
  }
}

export async function withStayPut<T>(
  run: () => Promise<T>,
  opts?: { keepSpawned?: boolean },
): Promise<T> {
  const prev = await snapshotFocus();
  hold = prev;
  spawned.clear();
  try {
    return await run();
  }
  finally {
    const extras = [...spawned];
    hold = null;
    spawned.clear();
    if (opts?.keepSpawned !== true) {
      for (const id of extras)
        await browser.tabs.remove(id).catch(() => {});
    }

    await restoreFocus(prev);
  }
}

import { restoreFocus, snapshotFocus, withStayPut } from './focus-lock';

const WORKER_KEY = 'workerTabId';

export type TabRow = {
  id: number;
  title: string;
  url: string;
  pinned: boolean;
  hh: boolean;
};

export type WorkerCheck = {
  ok: boolean;
  reason?: string;
  url?: string;
  pinned?: boolean;
  tabId?: number;
};

export function isHhUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return host === 'hh.ru' || host.endsWith('.hh.ru');
  }
  catch {
    return false;
  }
}

export async function getWorkerTabId(): Promise<number | null> {
  const stored = await chrome.storage.local.get(WORKER_KEY);
  const id = stored[WORKER_KEY];

  return typeof id === 'number' ? id : null;
}

export async function listJobTabs(): Promise<TabRow[]> {
  const tabs = await chrome.tabs.query({});
  const rows: TabRow[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== 'number')
      continue;

    const url = tab.url || tab.pendingUrl || '';
    rows.push({
      id: tab.id,
      title: tab.title || url || `tab ${tab.id}`,
      url,
      pinned: tab.pinned === true,
      hh: isHhUrl(url),
    });
  }

  rows.sort((left, right) => Number(right.hh) - Number(left.hh) || left.id - right.id);

  return rows;
}

export async function pinWorker(tabId: number): Promise<WorkerCheck> {
  const prev = await snapshotFocus();
  await chrome.tabs.update(tabId, { pinned: true, active: false });
  await chrome.storage.local.set({ [WORKER_KEY]: tabId });
  await restoreFocus(prev);

  return checkWorker();
}

export async function checkWorker(): Promise<WorkerCheck> {
  const tabId = await getWorkerTabId();
  if (tabId === null)
    return { ok: false, reason: 'вкладка не выбрана' };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  }
  catch {
    return { ok: false, reason: 'вкладка закрыта', tabId };
  }

  const url = tab.url || tab.pendingUrl || '';
  if (isHhUrl(url) === false)
    return { ok: false, reason: 'не HH', url, tabId, pinned: tab.pinned === true };

  if (tab.pinned !== true)
    return { ok: false, reason: 'пин снят', url, tabId, pinned: false };

  return { ok: true, url, tabId, pinned: true };
}

export async function requireWorkerTab(): Promise<chrome.tabs.Tab> {
  const check = await checkWorker();
  if (check.ok === false || typeof check.tabId !== 'number')
    throw new Error(`HH tab not ready: ${check.reason || 'unknown'}. Pin it in the Cursor Chrome popup.`);

  return chrome.tabs.get(check.tabId);
}

export async function openHhBackground(): Promise<WorkerCheck> {
  return withStayPut(() => createHhTab(), { keepSpawned: true });
}

async function createHhTab(): Promise<WorkerCheck> {
  const created = await chrome.tabs.create({ url: 'https://hh.ru', active: false });
  if (typeof created.id !== 'number')
    throw new Error('не удалось открыть HH');

  await waitTab(created.id);

  return pinWorker(created.id);
}

async function waitTab(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, 10_000);
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId || info.status !== 'complete')
        return;

      finish();
    };
    function finish(): void {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function ensureHhWorker(): Promise<WorkerCheck> {
  const current = await checkWorker();
  if (current.ok)
    return current;

  return withStayPut(async () => {
    const rows = await listJobTabs();
    const known = rows.find(row => row.hh && row.id === current.tabId);
    const hh = known || rows.find(row => row.hh);
    if (hh)
      return pinWorker(hh.id);

    return createHhTab();
  }, { keepSpawned: true });
}

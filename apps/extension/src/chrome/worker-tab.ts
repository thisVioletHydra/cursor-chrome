import { getFlags } from './flags';
import { restoreFocus, snapshotFocus, withStayPut } from './focus-lock';
import { browser } from '../browser-host';

const WORKER_KEY = 'workerTabId';
const HH_HOME = 'https://hh.ru';
const HH_SEARCH = 'https://hh.ru/search/vacancy';

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
  status?: string;
  url?: string;
  pinned?: boolean;
  tabId?: number;
};

export function isHhUrl(url: string): boolean {
  return hostIs(url, 'hh.ru');
}

function isWorkerUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;

    return protocol === 'http:' || protocol === 'https:';
  }
  catch {
    return false;
  }
}

function hostIs(url: string, root: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return host === root || host.endsWith(`.${root}`);
  }
  catch {
    return false;
  }
}

export async function getWorkerTabId(): Promise<number | null> {
  const stored = await browser.storage.local.get(WORKER_KEY);
  const id = stored[WORKER_KEY];

  return typeof id === 'number' ? id : null;
}

export async function listJobTabs(): Promise<TabRow[]> {
  const tabs = await browser.tabs.query({});
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
  await browser.tabs.update(tabId, { pinned: true, active: false });
  await browser.storage.local.set({ [WORKER_KEY]: tabId });
  await dropExtraHhPins(tabId);
  await restoreFocus(prev);

  return checkWorker();
}

export async function closePinnedHh(): Promise<void> {
  const prev = await snapshotFocus();
  const workerId = await getWorkerTabId();
  const rows = await listJobTabs();
  for (const row of rows) {
    if (row.hh === false)
      continue;

    if (row.pinned === false && row.id !== workerId)
      continue;

    await browser.tabs.remove(row.id).catch(() => {});
  }

  await browser.storage.local.remove(WORKER_KEY);
  await restoreFocus(prev);
}

export async function checkWorker(): Promise<WorkerCheck> {
  const tabId = await getWorkerTabId();
  if (tabId === null)
    return { ok: false, reason: 'вкладка не выбрана' };

  let tab: chrome.tabs.Tab;
  try {
    tab = await browser.tabs.get(tabId);
  }
  catch {
    return { ok: false, reason: 'вкладка закрыта', tabId };
  }

  const url = tab.url || tab.pendingUrl || '';
  if (isWorkerUrl(url) === false)
    return { ok: false, reason: 'не http(s)', url, tabId, pinned: tab.pinned === true };

  if (tab.pinned !== true)
    return { ok: false, reason: 'пин снят', url, tabId, pinned: false };

  return { ok: true, url, tabId, pinned: true };
}

export async function requireWorkerTab(): Promise<chrome.tabs.Tab> {
  const check = await checkWorker();
  if (check.ok === false || typeof check.tabId !== 'number')
    throw new Error(`HH tab not ready: ${check.reason || 'unknown'}. Pin it in the Cursor Chrome popup.`);

  return browser.tabs.get(check.tabId);
}

export async function openHhBackground(): Promise<WorkerCheck> {
  return adoptHhWorker();
}

export async function ensureHhWorker(): Promise<WorkerCheck> {
  return adoptHhWorker();
}

export async function openHhDetached(url: string): Promise<{ id?: number; url: string; detached: true }> {
  if (isHhUrl(url) === false)
    throw new Error('detach only for HH');

  return withStayPut(() => createUnpinned(url), { keepSpawned: true });
}

export async function handoffWorkerToHuman(url: string): Promise<{ id?: number; url: string; detached: true }> {
  return withStayPut(async () => {
    const opened = await createUnpinned(url);
    const workerId = await getWorkerTabId();
    if (typeof workerId === 'number')
      await browser.tabs.update(workerId, { url: HH_SEARCH, active: false });

    return opened;
  }, { keepSpawned: true });
}

async function createUnpinned(url: string): Promise<{ id?: number; url: string; detached: true }> {
  const vacancyId = vacancyIdOf(url);
  const workerId = await getWorkerTabId();
  const hh = isHhUrl(url);
  const existing = (await listJobTabs()).find((row) => {
    if (row.pinned === true || row.id === workerId)
      return false;

    if (hh && row.hh === false)
      return false;

    return sameVacancy(row.url, url, vacancyId);
  });
  if (existing)
    return { id: existing.id, url: existing.url, detached: true };

  const created = await browser.tabs.create({ url, active: false, pinned: false });
  if (typeof created.id !== 'number')
    throw new Error('не удалось открыть вкладку');

  await waitTab(created.id, 15_000);
  const fresh = await browser.tabs.get(created.id);
  const unpin = fresh.pinned === true
    ? browser.tabs.update(created.id, { pinned: false, active: false })
    : Promise.resolve();
  await unpin;

  return { id: created.id, url: fresh.url || url, detached: true };
}

function vacancyIdOf(url: string): string {
  try {
    const parsed = new URL(url);

    return parsed.pathname.match(/\/vacancy\/(\d+)/)?.[1]
      || parsed.searchParams.get('vacancyId')
      || '';
  }
  catch {
    return '';
  }
}

function sameVacancy(left: string, right: string, vacancyId: string): boolean {
  if (vacancyId.length > 0 && vacancyIdOf(left) === vacancyId)
    return true;

  return left.split('?')[0] === right.split('?')[0];
}

export async function adoptHhWorker(url?: string): Promise<WorkerCheck> {
  const target = url && isHhUrl(url) ? url : undefined;
  const flags = await getFlags();
  const existing = pickHhTab(await listJobTabs(), await getWorkerTabId());

  if (flags.keepSession && existing)
    return resumeHh(existing.id, target);

  return replaceHh(target || HH_HOME, existing?.id);
}

async function resumeHh(tabId: number, url?: string): Promise<WorkerCheck> {
  const pinned = await pinWorker(tabId);
  if (url === undefined)
    return pinned;

  await browser.tabs.update(tabId, { url, active: false });
  await waitTab(tabId);

  return checkWorker();
}

async function replaceHh(url: string, oldId?: number): Promise<WorkerCheck> {
  return withStayPut(async () => {
    const created = await browser.tabs.create({ url, active: false });
    if (typeof created.id !== 'number')
      throw new Error('не удалось открыть HH');

    await waitTab(created.id);
    const pinned = await pinWorker(created.id);
    if (typeof oldId === 'number' && oldId !== created.id)
      await browser.tabs.remove(oldId).catch(() => {});

    return pinned;
  }, { keepSpawned: true });
}

async function dropExtraHhPins(keepId: number): Promise<void> {
  const rows = await listJobTabs();
  for (const row of rows) {
    if (row.id === keepId || row.hh === false || row.pinned === false)
      continue;

    await browser.tabs.remove(row.id).catch(() => {});
  }
}

function pickHhTab(rows: TabRow[], workerId: number | null): TabRow | undefined {
  const hh = rows.filter(row => row.hh);
  const stored = hh.find(row => row.id === workerId);
  const pinned = hh.find(row => row.pinned);

  return stored || pinned || hh[0];
}

export async function waitTab(tabId: number, timeoutMs = 10_000): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId || info.status !== 'complete')
        return;

      finish();
    };
    function finish(): void {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

import { getFlags } from './flags';
import { restoreFocus, snapshotFocus, withStayPut } from './focus-lock';
import { browser } from '../browser-host';

export const WORKER_KEY = 'workerTabId';
const SEARCH = 'https://hh.ru/search/vacancy';
const USER_PAGE = /\/resume(?:_converter|_print)?(?:\/|$)|\/chat(?:\/|$)/i;

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

export function isBotWorkUrl(url: string): boolean {
  if (isHhUrl(url) === false)
    return false;

  try {
    const path = new URL(url).pathname;
    if (USER_PAGE.test(path))
      return false;

    if (path === '/search/vacancy' || path.startsWith('/search/vacancy/'))
      return true;

    if (/^\/vacancy\/\d+/.test(path))
      return true;

    return /vacancy_response/i.test(path);
  }
  catch {
    return false;
  }
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
  await browser.tabs.update(tabId, { pinned: true, autoDiscardable: false });
  await browser.storage.local.set({ [WORKER_KEY]: tabId });
  await wakeWorkerTab(tabId);

  return checkWorker();
}

export async function closePinnedHh(): Promise<void> {
  const workerId = await getWorkerTabId();
  const prev = await snapshotFocus().catch(() => null);
  let drop = true;
  try {
    if (typeof workerId !== 'number')
      return;

    const tab = await browser.tabs.get(workerId).catch(() => null);
    if (tab === null)
      return;

    const url = tab.url || tab.pendingUrl || '';
    if (isBotWorkUrl(url)) {
      await browser.tabs.remove(workerId).catch(() => {});
      drop = await browser.tabs.get(workerId).catch(() => null) === null;

      return;
    }

    if (tab.pinned === true && isHhUrl(url))
      await browser.tabs.update(workerId, { pinned: false }).catch(() => {});
  }
  finally {
    if (drop)
      await browser.storage.local.remove(WORKER_KEY);

    await restoreFocus(prev);
  }
}

// Хром не грузит вкладку, открытую в фоне, пока её один раз не активировать.
export async function wakeWorkerTab(tabId: number, force = false): Promise<void> {
  await browser.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab === null || (force === false && asleep(tab) === false))
    return;

  const prev = await snapshotFocus();
  await browser.tabs.update(tabId, { active: true });
  if (prev !== null && prev.tabId !== tabId)
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

export async function openOnHhTab(url: string): Promise<WorkerCheck> {
  const href = httpHref(url);
  const existing = ownWorkTab(await listJobTabs(), await getWorkerTabId());
  if (existing)
    return resumeHh(existing.id, href);

  return openOnlyHh(href);
}

export async function openBotSearch(url: string): Promise<WorkerCheck> {
  const own = ownWorkTab(await listJobTabs(), await getWorkerTabId());
  if (own) {
    const pinned = await resumeHh(own.id, isBotWorkUrl(own.url) ? undefined : url);

    return { ...pinned, status: pinned.ok ? 'Уже открыта' : pinned.reason };
  }

  const opened = await openOnlyHh(url);

  return { ...opened, status: opened.ok ? 'Открыл и запинил' : opened.reason };
}

export async function adoptHhWorker(url?: string): Promise<WorkerCheck> {
  const asked = url && isHhUrl(url) ? url : undefined;
  const flags = await getFlags();
  const existing = ownWorkTab(await listJobTabs(), await getWorkerTabId());
  if (existing === undefined)
    return openOnlyHh(asked || SEARCH);

  const next = asked ?? (flags.keepSession ? undefined : SEARCH);

  return resumeHh(existing.id, next);
}

function httpHref(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch {
    throw new Error('нужен http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('нужен http(s) URL');

  return parsed.href;
}

async function openOnlyHh(url: string): Promise<WorkerCheck> {
  const raced = ownWorkTab(await listJobTabs(), await getWorkerTabId());
  if (raced)
    return resumeHh(raced.id, url);

  const previous = await getWorkerTabId();
  const tabId = await withStayPut(async () => {
    const created = await browser.tabs.create({ url, active: false });
    if (typeof created.id !== 'number')
      throw new Error('не удалось открыть HH');

    return created.id;
  }, { keepSpawned: true });

  await wakeWorkerTab(tabId, true);
  await waitLoaded(tabId);
  const pinned = await pinWorker(tabId);
  await releaseOldPin(previous, tabId);

  return pinned;
}

async function resumeHh(tabId: number, url?: string): Promise<WorkerCheck> {
  const pinned = await pinWorker(tabId);
  if (url === undefined || pinned.ok === false)
    return pinned;

  const here = await browser.tabs.get(tabId).catch(() => null);
  const current = here?.url || here?.pendingUrl || '';
  if (current === url)
    return pinned;

  await wakeWorkerTab(tabId);
  const loaded = waitTab(tabId);
  await browser.tabs.update(tabId, { url, active: false });
  await loaded;

  return checkWorker();
}

async function releaseOldPin(previous: number | null, nextId: number): Promise<void> {
  if (typeof previous !== 'number' || previous === nextId)
    return;

  const tab = await browser.tabs.get(previous).catch(() => null);
  const url = tab?.url || tab?.pendingUrl || '';
  if (tab?.pinned !== true || isHhUrl(url) === false)
    return;

  await browser.tabs.update(previous, { pinned: false }).catch(() => {});
}

function ownWorkTab(rows: TabRow[], workerId: number | null): TabRow | undefined {
  if (workerId === null)
    return undefined;

  const row = rows.find(item => item.id === workerId);
  if (row === undefined || isHhUrl(row.url) === false || userHh(row.url))
    return undefined;

  return row;
}

function userHh(url: string): boolean {
  try {
    return USER_PAGE.test(new URL(url).pathname);
  }
  catch {
    return false;
  }
}

function asleep(tab: chrome.tabs.Tab): boolean {
  if (tab.discarded === true || tab.frozen === true)
    return true;

  return tab.status !== 'complete' && tab.status !== 'loading';
}

async function waitLoaded(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab !== null && tab.status === 'complete' && tab.discarded !== true && tab.frozen !== true)
    return;

  await waitTab(tabId);
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

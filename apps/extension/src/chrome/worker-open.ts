import type { WorkerCheck } from './worker-tab';

import { withStayPut } from './focus-lock';
import { adoptHhWorker, checkWorker, getWorkerTabId, isHhUrl, listJobTabs, pinWorker, waitTab } from './worker-tab';
import { browser } from '../browser-host';

export function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;

    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/'))
      path = path.slice(0, -1);

    return `${parsed.origin}${path}`;
  }
  catch {
    return null;
  }
}

export async function openPinnedWorker(url: string): Promise<WorkerCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch {
    throw new Error('нужен http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('нужен http(s) URL');

  const href = parsed.href;
  if (isHhUrl(href)) {
    const had = (await listJobTabs()).some(row => row.hh);
    const pinned = await adoptHhWorker(href);

    return { ...pinned, status: had ? 'Запинил уже открытую' : 'Открыл и запинил' };
  }

  const key = pageKey(href);
  if (key === null)
    throw new Error('нужен http(s) URL');

  const workerId = await getWorkerTabId();
  const match = (await listJobTabs()).find(row => pageKey(row.url) === key);
  if (match) {
    if (match.id === workerId && match.pinned === true) {
      const check = await checkWorker();

      return { ...check, status: 'Уже открыта' };
    }

    const pinned = await pinWorker(match.id);

    return { ...pinned, status: 'Запинил уже открытую' };
  }

  const oldId = workerId;

  return withStayPut(async () => {
    const created = await browser.tabs.create({ url: href, active: false, pinned: true });
    if (typeof created.id !== 'number')
      throw new Error('не удалось открыть вкладку');

    await waitTab(created.id);
    const pinned = await pinWorker(created.id);
    await forgetWorker(oldId, created.id);

    return { ...pinned, status: 'Открыл и запинил' };
  }, { keepSpawned: true });
}

async function forgetWorker(tabId: number | null, createdId: number): Promise<void> {
  if (typeof tabId !== 'number' || tabId === createdId)
    return;

  const tab = await browser.tabs.get(tabId).catch(() => null);
  const url = tab?.url || tab?.pendingUrl || '';
  if (isHhUrl(url))
    return;

  await browser.tabs.remove(tabId).catch(() => {});
}

const HH_HOME = 'https://hh.ru';

export async function ensurePinnedHh(): Promise<WorkerCheck> {
  const ready = await pinnedHh();
  if (ready)
    return ready;

  const workerId = await getWorkerTabId();
  const hh = (await listJobTabs()).filter(row => row.hh);
  const existing = hh.find(row => row.id === workerId) || hh.find(row => row.pinned) || hh[0];
  if (existing) {
    const pinned = await pinWorker(existing.id);

    return { ...pinned, status: 'Запинил уже открытую' };
  }

  return openFreshHh();
}

async function pinnedHh(): Promise<WorkerCheck | null> {
  const check = await checkWorker();
  if (check.ok !== true || isHhUrl(check.url || '') === false)
    return null;

  return { ...check, status: 'Запинил' };
}

async function openFreshHh(): Promise<WorkerCheck> {
  const again = (await listJobTabs()).find(row => row.hh);
  if (again) {
    const pinned = await pinWorker(again.id);

    return { ...pinned, status: 'Запинил уже открытую' };
  }

  return withStayPut(async () => {
    const created = await createHhTab();
    await waitTab(created);
    const pinned = await pinWorker(created);
    if (pinned.ok === false)
      throw new Error(pinned.reason || 'не удалось запинить');

    return { ...pinned, status: 'Открыл hh и запинил' };
  }, { keepSpawned: true });
}

async function createHhTab(): Promise<number> {
  try {
    const created = await browser.tabs.create({ url: HH_HOME, active: false });
    if (typeof created.id !== 'number')
      throw new Error('не удалось открыть вкладку');

    return created.id;
  }
  catch (error) {
    if (error instanceof Error && error.message.length > 0)
      throw error;

    throw new Error('не удалось открыть вкладку');
  }
}


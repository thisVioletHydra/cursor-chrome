import type { WorkerCheck } from './worker-tab';

import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { withStayPut } from './focus-lock';
import { huntSearchUrl } from '../search/hh-search';
import { adoptHhWorker, checkWorker, getWorkerTabId, isBotWorkUrl, isHhUrl, listJobTabs, openBotSearch, pinWorker, waitTab } from './worker-tab';
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
    const workerId = await getWorkerTabId();
    const own = (await listJobTabs()).some(row => row.id === workerId && isBotWorkUrl(row.url));
    const pinned = await adoptHhWorker(href);

    return { ...pinned, status: own ? 'Уже открыта' : 'Открыл и запинил' };
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

export async function ensurePinnedHh(): Promise<WorkerCheck> {
  return openBotSearch(await firstQueryUrl());
}

async function firstQueryUrl(): Promise<string> {
  return huntSearchUrl(await loadQueries());
}

async function loadQueries(): Promise<string[]> {
  try {
    const [raw, key] = await Promise.all([getSyncUrl(), getSyncKey()]);
    const base = originOf(raw);
    if (base.length === 0 || key.length === 0)
      return [];

    const res = await fetch(`${base}/api/queue`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok === false)
      return [];

    const body = await res.json() as { queries?: unknown };
    if (Array.isArray(body.queries) === false)
      return [];

    return body.queries.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  catch {
    return [];
  }
}

function originOf(raw: string): string {
  try {
    const url = new URL(raw.trim());

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}


import type { WorkerCheck } from './worker-tab';

import { browser } from '../browser-host';
import { withStayPut } from './focus-lock';
import { checkWorker, getWorkerTabId, listJobTabs, pinWorker, waitTab } from './worker-tab';

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
    if (typeof oldId === 'number' && oldId !== created.id)
      await browser.tabs.remove(oldId).catch(() => {});

    return { ...pinned, status: 'Открыл и запинил' };
  }, { keepSpawned: true });
}


import type { CommandName } from '@cursor-chrome/protocol';

import { requireWorkerTab } from './worker-tab';
import { browser } from '../browser-host';

export const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|chrome-search):/i;

export function hasTabId(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab?.id === 'number';
}

export function requireTabId(tab: chrome.tabs.Tab): number {
  if (hasTabId(tab) === false)
    throw new Error('Tab has no id');

  return tab.id;
}

export async function ensureContent(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = requireTabId(tab);
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot inject into restricted URL: ${tab.url}`);

  const frameIds = await listFrameIds(tabId);
  for (const frameId of frameIds) {
    try {
      await browser.tabs.sendMessage(tabId, { type: 'ping' }, { frameId });
    }
    catch {
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content.js'],
      }).catch(() => {});
    }
  }
}

export async function listFrameIds(tabId: number): Promise<number[]> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true,
    });
    const ids = results
      .map(item => item.frameId)
      .filter((frameId): frameId is number => typeof frameId === 'number');
    ids.sort((left, right) => left - right);

    return ids.length ? ids : [0];
  }
  catch {
    return [0];
  }
}

export async function frameMessage(
  tabId: number,
  frameId: number,
  method: CommandName,
  params: Record<string, unknown>,
): Promise<unknown> {
  const result = await browser.tabs.sendMessage(tabId, { type: 'command', method, params }, { frameId });
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(String((result as { error: unknown }).error));

  return result;
}

export async function workerTopMessage(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const tab = await requireWorkerTab();
  await ensureContent(tab);
  const result = await browser.tabs.sendMessage(requireTabId(tab), { type, ...extra }, { frameId: 0 });
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(String((result as { error: unknown }).error));

  return result;
}

import type { CommandName } from '@cursor-chrome/protocol';

import { getFlags } from './flags';
import { withStayPut } from './focus-lock';
import { runHhApply } from './hh-apply-cmd';
import { detachAndLog } from './human-review';
import { ensureContent, frameMessage, hasTabId, listFrameIds, RESTRICTED, requireTabId } from './inject';
import { adoptHhWorker, checkWorker, isHhUrl, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

type CommandCtx = {
  method: CommandName;
  params: Record<string, unknown>;
  connected: boolean;
};

async function injected(run: (tabId: number) => Promise<unknown>): Promise<unknown> {
  const tab = await requireWorkerTab();
  await ensureContent(tab);

  return run(requireTabId(tab));
}

function locator({ method, params }: CommandCtx): Promise<unknown> {
  return injected(tabId => dispatchLocator(tabId, method, params));
}

function pageCmd({ method, params }: CommandCtx): Promise<unknown> {
  return injected(tabId => frameMessage(tabId, 0, method, params));
}

const commands: Record<CommandName, (ctx: CommandCtx) => Promise<unknown>> = {
  ping: async ({ connected }) => ({ ok: true, connected, ...(await getFlags()) }),
  browser_new_tab: async ({ params }) => newTab(params),
  browser_navigate: async ({ params }) => navigate(await requireWorkerTab(), String(params.url || '')),
  browser_go_back: async () => historyNav(await requireWorkerTab(), -1),
  browser_go_forward: async () => historyNav(await requireWorkerTab(), 1),
  browser_screenshot: async () => screenshot(await requireWorkerTab()),
  browser_snapshot: async () => injected(snapshotAll),
  browser_get_console_logs: async () => injected(consoleLogsAll),
  browser_click: locator,
  browser_hover: locator,
  browser_type: locator,
  browser_select_option: locator,
  browser_press_key: pageCmd,
  browser_wait: pageCmd,
  hh_apply: async () => runHhApply(),
};

export async function runCommand(
  method: CommandName,
  params: Record<string, unknown>,
  connected: boolean,
): Promise<unknown> {
  const ctx: CommandCtx = { method, params, connected };
  if (method === 'browser_new_tab' && params.background === false)
    return commands[method](ctx);

  return withStayPut(
    () => commands[method](ctx),
    { keepSpawned: method === 'browser_new_tab' },
  );
}

export async function pageInfo(): Promise<{ url: string; frames: number; hideJunk: boolean }> {
  const flags = await getFlags();
  const check = await checkWorker();
  if (check.ok === false || typeof check.tabId !== 'number')
    return { url: '', frames: 0, hideJunk: flags.hideJunk };

  const tab = await browser.tabs.get(check.tabId);
  const frames = hasTabId(tab) ? (await listFrameIds(tab.id)).length : 0;

  return { url: tab.url || tab.pendingUrl || '', frames, hideJunk: flags.hideJunk };
}

async function newTab(params: Record<string, unknown>): Promise<unknown> {
  const url = String(params.url || '');
  const detach = params.detach === true || params.review === true;
  if (url && RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);

  const kind = url && isHhUrl(url) ? (detach ? 'detach' : 'worker') : 'plain';
  const openers = {
    detach: () => detachAndLog(url, params),
    worker: async () => {
      const worker = await adoptHhWorker(url);

      return { id: worker.tabId, url: worker.url || url };
    },
    plain: () => openPlainTab(url, params.background !== false),
  };

  return openers[kind]();
}

async function openPlainTab(url: string, background: boolean): Promise<unknown> {
  const created = await browser.tabs.create({
    ...(url ? { url } : {}),
    active: background === false,
  });
  if (hasTabId(created) && url)
    await waitTab(created.id, 15_000);

  const fresh = hasTabId(created) ? await browser.tabs.get(created.id) : created;

  return { id: fresh.id, url: fresh.url || url || '' };
}

async function navigate(tab: chrome.tabs.Tab, url: string): Promise<unknown> {
  if (url.length === 0)
    throw new Error('url is required');

  if (RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);

  const tabId = requireTabId(tab);
  const wait = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url, active: false });
  await wait;
  const fresh = await browser.tabs.get(tabId);

  return { url: fresh.url || url };
}

async function historyNav(tab: chrome.tabs.Tab, delta: number): Promise<unknown> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot control restricted URL: ${tab.url}`);

  const tabId = requireTabId(tab);
  const wait = waitTab(tabId, 2_000);
  await browser.scripting.executeScript({
    target: { tabId },
    func: (step: number) => history.go(step),
    args: [delta],
  });
  await wait;
  const fresh = await browser.tabs.get(tabId);

  return { url: fresh.url };
}

async function screenshot(tab: chrome.tabs.Tab): Promise<{ data: string; mimeType: string }> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot screenshot restricted URL: ${tab.url}`);

  const windowInfo = await browser.windows.get(tab.windowId, { populate: true });
  const shown = windowInfo.tabs?.find(item => item.active);
  if (shown?.id !== tab.id)
    throw new Error('Worker tab is in the background; use snapshot instead of screenshot');

  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const prefix = 'data:image/png;base64,';
  const data = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;

  return { data, mimeType: 'image/png' };
}

function parseRef(ref: string): { frameId: number; localRef: string } {
  const nested = ref.match(/^f(\d+)(e\d+)$/);
  if (nested)
    return { frameId: Number(nested[1]), localRef: nested[2] };

  return { frameId: 0, localRef: ref };
}

async function snapshotAll(tabId: number): Promise<string> {
  const frameIds = await listFrameIds(tabId);
  const chunks: string[] = [];
  for (const frameId of frameIds) {
    try {
      const text = await frameMessage(tabId, frameId, 'browser_snapshot', {});
      if (typeof text !== 'string' || text.length === 0)
        continue;

      if (frameId === 0) {
        chunks.push(text);
        continue;
      }

      const rewritten = text.replace(/\[ref=(e\d+)\]/g, `[ref=f${frameId}$1]`);
      const lines = rewritten.split('\n');
      const frameUrl = lines[0]?.replace(/^- page url=/, '') || '';
      chunks.push(`- iframe url=${frameUrl} [frame=${frameId}]`);
      for (const line of lines.slice(2)) {
        if (line)
          chunks.push(`  ${line}`);
      }
    }
    catch {
    }
  }

  return chunks.join('\n');
}

async function consoleLogsAll(tabId: number): Promise<unknown> {
  const frameIds = await listFrameIds(tabId);
  const all: unknown[] = [];
  for (const frameId of frameIds) {
    try {
      const logs = await frameMessage(tabId, frameId, 'browser_get_console_logs', {});
      if (Array.isArray(logs))
        all.push(...logs);
    }
    catch {
    }
  }

  return all;
}

async function dispatchLocator(tabId: number, method: CommandName, params: Record<string, unknown>): Promise<unknown> {
  const ref = String(params.ref || '');
  const selector = String(params.selector || '');
  if (ref && selector)
    throw new Error('Pass either ref or selector, not both');

  if (ref.length === 0 && selector.length === 0)
    throw new Error('Pass exactly one of ref or selector');

  if (ref.length > 0) {
    const { frameId, localRef } = parseRef(ref);

    return frameMessage(tabId, frameId, method, { ...params, ref: localRef, selector: '' });
  }

  const frameIds = await listFrameIds(tabId);
  const misses: string[] = [];
  for (const frameId of frameIds) {
    try {
      return await frameMessage(tabId, frameId, method, params);
    }
    catch (error) {
      misses.push(`frame ${frameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`selector not found: ${selector}${misses.length ? ` (${misses.join('; ')})` : ''}`);
}

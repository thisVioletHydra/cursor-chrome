import type { CommandName } from '@cursor-chrome/protocol';

import { getFlags } from './flags';
import { withStayPut } from './focus-lock';
import { checkWorker, isHhUrl, pinWorker, requireWorkerTab } from './worker-tab';

const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|chrome-search):/i;

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
  browser_new_tab: async ({ params }) => newTab(String(params.url || ''), params.background !== false),
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

  const tab = await chrome.tabs.get(check.tabId);
  const frames = hasTabId(tab) ? (await listFrameIds(tab.id)).length : 0;

  return { url: tab.url || tab.pendingUrl || '', frames, hideJunk: flags.hideJunk };
}

function hasTabId(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab?.id === 'number';
}

function requireTabId(tab: chrome.tabs.Tab): number {
  if (hasTabId(tab) === false)
    throw new Error('Tab has no id');

  return tab.id;
}

async function newTab(url: string, background: boolean): Promise<unknown> {
  if (url && RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);

  const created = await chrome.tabs.create({
    ...(url ? { url } : {}),
    active: background === false,
  });
  if (hasTabId(created) && url)
    await waitComplete(created.id, 15_000);

  const fresh = hasTabId(created) ? await chrome.tabs.get(created.id) : created;
  if (background && hasTabId(fresh) && isHhUrl(fresh.url || url))
    await pinWorker(fresh.id);

  return { id: fresh.id, url: fresh.url || url || '' };
}

async function navigate(tab: chrome.tabs.Tab, url: string): Promise<unknown> {
  if (url.length === 0)
    throw new Error('url is required');

  if (RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);

  const tabId = requireTabId(tab);
  const wait = waitComplete(tabId, 15_000);
  await chrome.tabs.update(tabId, { url, active: false });
  await wait;
  const fresh = await chrome.tabs.get(tabId);

  return { url: fresh.url || url };
}

async function historyNav(tab: chrome.tabs.Tab, delta: number): Promise<unknown> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot control restricted URL: ${tab.url}`);

  const tabId = requireTabId(tab);
  const wait = waitComplete(tabId, 2_000);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (step: number) => history.go(step),
    args: [delta],
  });
  await wait;
  const fresh = await chrome.tabs.get(tabId);

  return { url: fresh.url };
}

async function screenshot(tab: chrome.tabs.Tab): Promise<{ data: string; mimeType: string }> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot screenshot restricted URL: ${tab.url}`);

  const windowInfo = await chrome.windows.get(tab.windowId, { populate: true });
  const shown = windowInfo.tabs?.find(item => item.active);
  if (shown?.id !== tab.id)
    throw new Error('Worker tab is in the background; use snapshot instead of screenshot');

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const prefix = 'data:image/png;base64,';
  const data = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;

  return { data, mimeType: 'image/png' };
}

async function ensureContent(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = requireTabId(tab);
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot inject into restricted URL: ${tab.url}`);

  const frameIds = await listFrameIds(tabId);
  for (const frameId of frameIds) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId });
    }
    catch {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content.js'],
      }).catch(() => {});
    }
  }
}

async function listFrameIds(tabId: number): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
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

async function frameMessage(tabId: number, frameId: number, method: CommandName, params: Record<string, unknown>): Promise<unknown> {
  const result = await chrome.tabs.sendMessage(tabId, { type: 'command', method, params }, { frameId });
  if (result && typeof result === 'object' && 'error' in result)
    throw new Error(String((result as { error: unknown }).error));

  return result;
}

async function waitComplete(tabId: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
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

import type { CommandName, WsRequest, WsResponse } from '@cursor-chrome/protocol';
import { NATIVE_CHUNK_BYTES, NATIVE_HOST_NAME } from '@cursor-chrome/protocol';

const ALARM = 'cc-keepalive';
const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|chrome-search):/i;
const HOST_MISSING = /native messaging host not found|forbidden|does not exist/i;

type Transport = 'native' | 'offscreen' | 'none';

let connected = false;
let detail = 'starting';
let transport: Transport = 'none';
let nativePort: chrome.runtime.Port | null = null;
let nativeRetry: ReturnType<typeof setTimeout> | undefined;
let ignoreNativeDisconnect = false;

chrome.runtime.onInstalled.addListener(() => {
  void boot();
});
chrome.runtime.onStartup.addListener(() => {
  void boot();
});
void boot();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM)
    return;
  void ensureOffscreen();
  connectNative();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive')
    return;
  port.onMessage.addListener(() => {
    try {
      port.postMessage({ t: Date.now() });
    }
    catch {
      // SW going down
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ws-status') {
    if (nativePort)
      return false;
    connected = Boolean(message.connected);
    detail = String(message.detail || '');
    transport = 'offscreen';
    void setBadge(connected);
    return false;
  }
  if (message?.type === 'get-status') {
    sendResponse({ connected, detail, transport });
    return true;
  }
  if (message?.type === 'reconnect') {
    void (async () => {
      try {
        await ensureOffscreen();
        await waitOffscreen();
        restartNative();
        await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
        sendResponse({ ok: true, detail: nativePort ? 'native reconnect' : 'offscreen reconnect sent' });
      }
      catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        detail = text;
        sendResponse({ ok: false, error: text });
      }
    })();
    return true;
  }
  if (message?.type === 'command') {
    void runCommand(message.method as CommandName, message.params || {}).then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'console-log' && sender.tab?.id != null)
    return false;
  return false;
});

async function boot(): Promise<void> {
  await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await ensureOffscreen();
  await waitOffscreen().catch(() => {});
  connectNative();
  await setBadge(connected);
}

function restartNative(): void {
  if (nativeRetry) {
    clearTimeout(nativeRetry);
    nativeRetry = undefined;
  }
  ignoreNativeDisconnect = true;
  try {
    nativePort?.disconnect();
  }
  catch {
    // already gone
  }
  ignoreNativeDisconnect = false;
  nativePort = null;
  connectNative();
}

function connectNative(): void {
  if (nativePort)
    return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  }
  catch (error) {
    nativePort = null;
    const text = error instanceof Error ? error.message : String(error);
    void enableWsFallback(text);
    return;
  }

  nativePort.onMessage.addListener((message) => {
    void onNativeMessage(message);
  });
  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || 'native host disconnected';
    nativePort = null;
    if (ignoreNativeDisconnect)
      return;
    if (transport === 'native') {
      connected = false;
      detail = err;
      void setBadge(false);
    }
    if (HOST_MISSING.test(err)) {
      void enableWsFallback(err);
      return;
    }
    nativeRetry = setTimeout(() => {
      nativeRetry = undefined;
      connectNative();
    }, 1000);
  });
}

async function onNativeMessage(message: unknown): Promise<void> {
  if (!message || typeof message !== 'object')
    return;
  const rec = message as Record<string, unknown>;
  if (rec.type === 'ws-status') {
    connected = Boolean(rec.connected);
    detail = String(rec.detail || '');
    transport = 'native';
    void setBadge(connected);
    void disableWsFallback();
    return;
  }
  if (typeof rec.id !== 'string' || typeof rec.method !== 'string')
    return;
  const request = rec as unknown as WsRequest;
  try {
    const result = await runCommand(request.method, request.params || {});
    postNative({ id: request.id, ok: true, result });
  }
  catch (error) {
    postNative({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function postNative(message: WsResponse): void {
  if (!nativePort)
    return;
  const json = JSON.stringify(message);
  if (json.length <= NATIVE_CHUNK_BYTES) {
    nativePort.postMessage(message);
    return;
  }
  const total = Math.ceil(json.length / NATIVE_CHUNK_BYTES);
  nativePort.postMessage({ type: 'chunk-start', id: message.id, total });
  for (let i = 0; i < total; i++) {
    nativePort.postMessage({
      type: 'chunk',
      id: message.id,
      i,
      data: json.slice(i * NATIVE_CHUNK_BYTES, (i + 1) * NATIVE_CHUNK_BYTES),
    });
  }
}

async function disableWsFallback(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'set-ws', enabled: false }).catch(() => {});
}

async function enableWsFallback(reason: string): Promise<void> {
  transport = 'offscreen';
  if (!connected)
    detail = HOST_MISSING.test(reason) ? 'запусти pnpm install-host' : reason;
  await chrome.runtime.sendMessage({ type: 'set-ws', enabled: true }).catch(() => {});
}

async function ensureOffscreen(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument?.() ?? false;
  if (hasDocument)
    return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keepalive port and optional WebSocket to the local Cursor MCP server',
    });
  }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes('Only a single offscreen'))
      detail = text;
  }
}

async function waitOffscreen(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const ping = await chrome.runtime.sendMessage({ type: 'ping-offscreen' }).catch(() => null);
    if (ping)
      return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Offscreen document did not start');
}

async function setBadge(on: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: on ? 'ON' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: on ? '#0a0' : '#c00' });
}

async function runCommand(method: CommandName, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'ping')
    return { ok: true, connected };

  if (method === 'browser_new_tab')
    return newTab(String(params.url || ''));

  const tab = await activeTab();
  if (method === 'browser_navigate')
    return navigate(tab, String(params.url || ''));
  if (method === 'browser_go_back')
    return historyNav(tab, -1);
  if (method === 'browser_go_forward')
    return historyNav(tab, 1);
  if (method === 'browser_screenshot')
    return screenshot(tab);

  await ensureContent(tab);
  return tabMessage(tab.id!, method, params);
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null)
    return tab;
  const [anyTab] = await chrome.tabs.query({ lastFocusedWindow: true });
  if (anyTab?.id != null)
    return anyTab;
  throw new Error('No Chrome tab available');
}

async function newTab(url: string): Promise<unknown> {
  if (url && RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);
  const created = await chrome.tabs.create(url ? { url, active: true } : { active: true });
  if (created.id != null && url)
    await waitComplete(created.id, 15_000);
  const fresh = created.id != null ? await chrome.tabs.get(created.id) : created;
  return { id: fresh.id, url: fresh.url || url || '' };
}

async function navigate(tab: chrome.tabs.Tab, url: string): Promise<unknown> {
  if (!url)
    throw new Error('url is required');
  if (RESTRICTED.test(url))
    throw new Error(`Cannot open restricted URL: ${url}`);
  const wait = waitComplete(tab.id!, 15_000);
  await chrome.tabs.update(tab.id!, { url });
  await wait;
  const fresh = await chrome.tabs.get(tab.id!);
  return { url: fresh.url || url };
}

async function historyNav(tab: chrome.tabs.Tab, delta: number): Promise<unknown> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot control restricted URL: ${tab.url}`);
  const wait = waitComplete(tab.id!, 2_000);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: (step: number) => history.go(step),
    args: [delta],
  });
  await wait;
  const fresh = await chrome.tabs.get(tab.id!);
  return { url: fresh.url };
}

async function screenshot(tab: chrome.tabs.Tab): Promise<{ data: string; mimeType: string }> {
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot screenshot restricted URL: ${tab.url}`);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const prefix = 'data:image/png;base64,';
  const data = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;
  return { data, mimeType: 'image/png' };
}

async function ensureContent(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null)
    throw new Error('Tab has no id');
  if (RESTRICTED.test(tab.url || ''))
    throw new Error(`Cannot inject into restricted URL: ${tab.url}`);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
  }
  catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  }
}

async function tabMessage(tabId: number, method: CommandName, params: Record<string, unknown>): Promise<unknown> {
  const result = await chrome.tabs.sendMessage(tabId, { type: 'command', method, params });
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

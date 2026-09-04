import type { CommandName } from '@cursor-chrome/protocol';

const ALARM = 'cc-keepalive';
const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|chrome-search):/i;

let connected = false;
let detail = 'starting';

chrome.runtime.onInstalled.addListener(() => {
  void boot();
});
chrome.runtime.onStartup.addListener(() => {
  void boot();
});
void boot();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM)
    void ensureOffscreen();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ws-status') {
    connected = Boolean(message.connected);
    detail = String(message.detail || '');
    void setBadge(connected);
    return false;
  }
  if (message?.type === 'get-status') {
    sendResponse({ connected, detail });
    return true;
  }
  if (message?.type === 'reconnect') {
    void (async () => {
      try {
        await ensureOffscreen();
        await waitOffscreen();
        await chrome.runtime.sendMessage({ type: 'reconnect' });
        sendResponse({ ok: true, detail: 'reconnect sent' });
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
  if (message?.type === 'console-log' && sender.tab?.id != null) {
    return false;
  }
  return false;
});

async function boot(): Promise<void> {
  await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  await ensureOffscreen();
  await setBadge(connected);
}

async function ensureOffscreen(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument?.() ?? false;
  if (hasDocument) {
    const ping = await chrome.runtime.sendMessage({ type: 'ping-offscreen' }).catch(() => null) as { connected?: boolean } | null;
    if (ping)
      connected = Boolean(ping.connected);
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keep WebSocket to the local Cursor MCP server',
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

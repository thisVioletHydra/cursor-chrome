import type { CommandName, WsRequest, WsResponse } from '@cursor-chrome/protocol';

import { NATIVE_CHUNK_BYTES, NATIVE_HOST_NAME } from '@cursor-chrome/protocol';
import { pageInfo, runCommand } from './commands';

const ALARM = 'cc-keepalive';
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
    sendResponse({ connected, detail, transport, version: chrome.runtime.getManifest().version });

    return true;
  }

  if (message?.type === 'get-page') {
    void pageInfo().then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

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
    void runCommand(message.method as CommandName, message.params || {}, connected).then(sendResponse).catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  }

  if (message?.type === 'console-log' && typeof sender.tab?.id === 'number')
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

    void enableWsFallback(err);
    if (HOST_MISSING.test(err))
      return;

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
    const result = await runCommand(request.method, request.params || {}, connected);
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
  if (nativePort === null)
    return;

  const json = JSON.stringify(message);
  if (json.length <= NATIVE_CHUNK_BYTES) {
    nativePort.postMessage(message);

    return;
  }

  const total = Math.ceil(json.length / NATIVE_CHUNK_BYTES);
  nativePort.postMessage({ type: 'chunk-start', id: message.id, total });
  for (let index = 0; index < total; index++) {
    nativePort.postMessage({
      type: 'chunk',
      id: message.id,
      i: index,
      data: json.slice(index * NATIVE_CHUNK_BYTES, (index + 1) * NATIVE_CHUNK_BYTES),
    });
  }
}

async function disableWsFallback(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'set-ws', enabled: false }).catch(() => {});
}

async function enableWsFallback(reason: string): Promise<void> {
  transport = 'offscreen';
  if (connected === false)
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
    if (text.includes('Only a single offscreen') === false)
      detail = text;
  }
}

async function waitOffscreen(): Promise<void> {
  for (let index = 0; index < 20; index++) {
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

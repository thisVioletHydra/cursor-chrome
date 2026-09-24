import type { CommandName, WsRequest } from '@cursor-chrome/protocol';

import { NATIVE_HOST_NAME } from '@cursor-chrome/protocol';
import { pageInfo, runCommand } from './chrome/commands';
import { installFocusLock } from './chrome/focus-lock';
import { runMakeGood } from './chrome/make-good';
import { postNative as sendNative } from './chrome/native-post';
import { ensureOffscreen, setBadge, waitOffscreen } from './chrome/offscreen-ctl';
import { rpc } from './chrome/rpc';
import { closePinnedHh } from './chrome/worker-tab';
import { browser } from './browser-host';

const ALARM = 'cc-keepalive';
const HOST_MISSING = /native messaging host not found|forbidden|does not exist/i;

type Transport = 'native' | 'offscreen' | 'none';

let connected = false;
let detail = 'starting';
let transport: Transport = 'none';
let nativePort: chrome.runtime.Port | null = null;
let nativeRetry: ReturnType<typeof setTimeout> | undefined;
let ignoreNativeDisconnect = false;
let heldOff = false;

browser.runtime.onInstalled.addListener(() => {
  void boot();
});
browser.runtime.onStartup.addListener(() => {
  void boot();
});
installFocusLock();
void boot();

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || changes.applyLog === undefined)
    return;

  void setBadge(connected);
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM)
    return;

  void ensureOffscreen().then((fail) => {
    if (fail)
      detail = fail;
  }).catch(() => {});
  if (heldOff)
    return;

  connectNative();
});

browser.runtime.onConnect.addListener((port) => {
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

type Incoming = {
  type?: string;
  connected?: unknown;
  detail?: unknown;
  method?: unknown;
  params?: unknown;
};

type Reply = (value?: unknown) => void;

const onRuntimeMessage: Record<string, (message: Incoming, sender: chrome.runtime.MessageSender, reply: Reply) => boolean> = {
  'ws-status': (message) => {
    if (nativePort)
      return false;

    connected = Boolean(message.connected);
    detail = String(message.detail || '');
    transport = 'offscreen';
    void setBadge(connected);

    return false;
  },
  'get-status': (_message, _sender, reply) => {
    reply({ connected, detail, transport, version: browser.runtime.getManifest().version });

    return true;
  },
  'get-page': (_message, _sender, reply) => replyAsync(reply, pageInfo()),
  reconnect: (_message, _sender, reply) => replyAsync(reply, reconnect()),
  'make-good': (_message, _sender, reply) => replyAsync(reply, runMakeGood({
    reconnect,
    snapshot: () => ({ connected, detail, transport }),
  })),
  hangup: (_message, _sender, reply) => replyAsync(reply, hangUp()),
  command: (message, _sender, reply) =>
    replyAsync(reply, runCommand(message.method as CommandName, (message.params || {}) as Record<string, unknown>, connected)),
  'console-log': () => false,
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string')
    return false;

  return onRuntimeMessage[type]?.(message, sender, sendResponse)
    ?? rpc[type]?.(message as Record<string, unknown>, sendResponse, sender)
    ?? false;
});

function replyAsync(reply: Reply, job: Promise<unknown>): true {
  void job.then(reply).catch((error) => {
    reply({ error: error instanceof Error ? error.message : String(error) });
  });

  return true;
}

async function reconnect(): Promise<{ ok: boolean; detail?: string; error?: string }> {
  heldOff = false;
  try {
    const offscreenFail = await ensureOffscreen();
    if (offscreenFail)
      detail = offscreenFail;

    await waitOffscreen();
    restartNative();
    await browser.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});

    return { ok: true, detail: nativePort ? 'native reconnect' : 'offscreen reconnect sent' };
  }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    detail = text;

    return { ok: false, error: text };
  }
}

async function hangUp(): Promise<{ ok: true }> {
  heldOff = true;
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
  connected = false;
  transport = 'none';
  detail = 'отключено';
  await disableWsFallback();
  await setBadge(false);
  await closePinnedHh();

  return { ok: true };
}

async function boot(): Promise<void> {
  await browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  const offscreenFail = await ensureOffscreen();
  if (offscreenFail)
    detail = offscreenFail;

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
  if (heldOff || nativePort)
    return;

  try {
    nativePort = browser.runtime.connectNative(NATIVE_HOST_NAME);
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
    const err = browser.runtime.lastError?.message || 'native host disconnected';
    nativePort = null;
    if (ignoreNativeDisconnect || heldOff)
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

const onNativeTyped: Record<string, (rec: Record<string, unknown>) => void> = {
  'ws-status': (rec) => {
    connected = Boolean(rec.connected);
    detail = String(rec.detail || '');
    transport = 'native';
    void setBadge(connected);
    void disableWsFallback();
  },
};

async function onNativeMessage(message: unknown): Promise<void> {
  if (!message || typeof message !== 'object')
    return;

  const rec = message as Record<string, unknown>;
  const typed = typeof rec.type === 'string' ? onNativeTyped[rec.type] : undefined;
  if (typed) {
    typed(rec);

    return;
  }

  if (typeof rec.id !== 'string' || typeof rec.method !== 'string')
    return;

  const request = rec as unknown as WsRequest;
  try {
    const result = await runCommand(request.method, request.params || {}, connected);
    sendNative(nativePort, { id: request.id, ok: true, result });
  }
  catch (error) {
    sendNative(nativePort, {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function disableWsFallback(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'set-ws', enabled: false }).catch(() => {});
}

async function enableWsFallback(reason: string): Promise<void> {
  if (heldOff)
    return;

  transport = 'offscreen';
  if (connected === false)
    detail = HOST_MISSING.test(reason) ? 'запусти pnpm install-host' : reason;

  await browser.runtime.sendMessage({ type: 'set-ws', enabled: true }).catch(() => {});
}

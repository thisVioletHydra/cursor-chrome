import type { CommandName, WsRequest, WsResponse } from '@cursor-chrome/protocol';

import { WS_URL } from '@cursor-chrome/protocol';

const CONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

let socket: WebSocket | null = null;
let keepPort: chrome.runtime.Port | null = null;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let wsEnabled = false;

keepAlive();

function keepAlive(): void {
  try {
    keepPort?.disconnect();
  }
  catch {
  }

  keepPort = chrome.runtime.connect({ name: 'keepalive' });
  keepPort.onDisconnect.addListener(() => {
    keepPort = null;
    setTimeout(keepAlive, 1000);
  });
}

setInterval(() => {
  try {
    keepPort?.postMessage({ t: Date.now() });
  }
  catch {
    keepAlive();
  }
}, 20_000);

function status(connected: boolean, detail = ''): void {
  void chrome.runtime.sendMessage({ type: 'ws-status', connected, detail }).catch(() => {});
}

function setWsEnabled(enabled: boolean): void {
  wsEnabled = enabled;
  if (!enabled) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }

    socket?.close();
    socket = null;
    return;
  }

  attempt = 0;
  connect();
}

function scheduleReconnect(): void {
  if (!wsEnabled || reconnectTimer)
    return;

  const delay = CONNECT_BACKOFF_MS[Math.min(attempt, CONNECT_BACKOFF_MS.length - 1)];
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}

function connect(): void {
  if (wsEnabled === null || wsEnabled === undefined)
    return;

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
    return;

  try {
    socket = new WebSocket(WS_URL);
  }
  catch (error) {
    status(false, error instanceof Error ? error.message : String(error));
    scheduleReconnect();

    return;
  }

  socket.addEventListener('open', () => {
    attempt = 0;
    status(true, WS_URL);
  });

  socket.addEventListener('message', async (event) => {
    let request: WsRequest;
    try {
      request = JSON.parse(String(event.data)) as WsRequest;
    }
    catch {
      return;
    }

    const response = await dispatch(request);
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(response));
  });

  socket.addEventListener('close', () => {
    socket = null;
    if (wsEnabled === null || wsEnabled === undefined)
      return;

    status(false, 'socket closed — MCP down or replaced');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    if (wsEnabled)
      status(false, 'no MCP on ws://127.0.0.1:18765');
  });
}

async function dispatch(request: WsRequest): Promise<WsResponse> {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'command',
      method: request.method as CommandName,
      params: request.params,
    });
    if (result && typeof result === 'object' && 'error' in result)
      return { id: request.id, ok: false, error: String((result as { error: unknown }).error) };

    return { id: request.id, ok: true, result };
  }
  catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const onOffscreenMessage: Record<string, (message: { enabled?: unknown }, reply: (value?: unknown) => void) => boolean> = {
  'ping-offscreen': (_message, reply) => {
    reply({
      ok: true,
      connected: socket?.readyState === WebSocket.OPEN,
      wsEnabled,
    });

    return true;
  },
  'set-ws': (message, reply) => {
    setWsEnabled(Boolean(message.enabled));
    reply({ ok: true, enabled: wsEnabled });

    return true;
  },
  reconnect: (_message, reply) => {
    if (wsEnabled === false) {
      reply({ ok: true, skipped: true });

      return true;
    }

    attempt = 0;
    socket?.close();
    socket = null;
    connect();
    reply({ ok: true });

    return true;
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string')
    return false;

  return onOffscreenMessage[type]?.(message, sendResponse) ?? false;
});

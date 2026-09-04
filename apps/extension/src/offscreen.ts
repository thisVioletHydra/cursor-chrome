import { WS_URL } from '@cursor-chrome/protocol';
import type { CommandName, WsRequest, WsResponse } from '@cursor-chrome/protocol';

const CONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

let socket: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

function status(connected: boolean, detail = ''): void {
  void chrome.runtime.sendMessage({ type: 'ws-status', connected, detail }).catch(() => {});
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer)
    return;
  const delay = CONNECT_BACKOFF_MS[Math.min(attempt, CONNECT_BACKOFF_MS.length - 1)];
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}

function connect(): void {
  if (stopped)
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
    status(false, 'socket closed');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    status(false, 'socket error');
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping-offscreen') {
    sendResponse({
      ok: true,
      connected: socket?.readyState === WebSocket.OPEN,
    });
    return true;
  }
  if (message?.type === 'reconnect') {
    stopped = false;
    attempt = 0;
    socket?.close();
    socket = null;
    connect();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

setInterval(() => {
  void chrome.runtime.sendMessage({
    type: 'ws-status',
    connected: socket?.readyState === WebSocket.OPEN,
    detail: WS_URL,
  }).catch(() => {});
}, 20_000);

connect();

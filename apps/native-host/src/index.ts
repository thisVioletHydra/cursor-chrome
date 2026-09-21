import { WS_URL } from '@cursor-chrome/protocol';
import { WebSocket } from 'ws';

import buffer from 'node:buffer';
import process from 'node:process';

const CONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
const MAX_NATIVE_BYTES = 1024 * 1024;

let socket: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let buf = buffer.Buffer.alloc(0);
const outbox: unknown[] = [];
const chunks = new Map<string, { total: number; parts: Array<string | undefined>; got: number }>();

process.stdin.on('data', (chunk: buffer.Buffer) => {
  buf = buffer.Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (len > MAX_NATIVE_BYTES) {
      log('native message too large', len);
      process.exit(1);
    }

    if (buf.length < 4 + len)
      return;

    const json = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    try {
      onChrome(JSON.parse(json));
    }
    catch (error) {
      log('bad json from chrome', error instanceof Error ? error.message : error);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

connect();

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
    return;

  try {
    socket = new WebSocket(WS_URL);
  }
  catch (error) {
    sendNative({ type: 'ws-status', connected: false, detail: error instanceof Error ? error.message : String(error) });
    scheduleReconnect();

    return;
  }

  socket.on('open', () => {
    attempt = 0;
    sendNative({ type: 'ws-status', connected: true, detail: WS_URL });
    while (outbox.length) {
      const item = outbox.shift();
      socket?.send(JSON.stringify(item));
    }
  });

  socket.on('message', (raw) => {
    try {
      sendNative(JSON.parse(String(raw)));
    }
    catch {
    }
  });

  socket.on('close', () => {
    socket = null;
    sendNative({ type: 'ws-status', connected: false, detail: 'socket closed — MCP down or replaced' });
    scheduleReconnect();
  });

  socket.on('error', () => {
    sendNative({ type: 'ws-status', connected: false, detail: 'no MCP on ws://127.0.0.1:18765' });
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer)
    return;

  const delay = CONNECT_BACKOFF_MS[Math.min(attempt, CONNECT_BACKOFF_MS.length - 1)];
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}

function onChrome(message: unknown): void {
  if (!message || typeof message !== 'object')
    return;

  const rec = message as Record<string, unknown>;
  if (isChunkStart(rec)) {
    chunks.set(rec.id, {
      total: rec.total,
      parts: Array.from({ length: rec.total }),
      got: 0,
    });

    return;
  }

  if (isChunkPart(rec)) {
    const slot = chunks.get(rec.id);
    if (slot === undefined)
      return;

    if (slot.parts[rec.i] === undefined) {
      slot.parts[rec.i] = rec.data;
      slot.got += 1;
    }

    if (slot.got === slot.total) {
      chunks.delete(rec.id);
      toMcp(JSON.parse(slot.parts.join('')));
    }

    return;
  }

  toMcp(message);
}

function isChunkStart(rec: Record<string, unknown>): rec is { type: 'chunk-start'; id: string; total: number } {
  return rec.type === 'chunk-start' && typeof rec.id === 'string' && typeof rec.total === 'number';
}

function isChunkPart(rec: Record<string, unknown>): rec is { type: 'chunk'; id: string; i: number; data: string } {
  return rec.type === 'chunk' && typeof rec.id === 'string' && typeof rec.i === 'number' && typeof rec.data === 'string';
}

function toMcp(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));

    return;
  }

  outbox.push(message);
}

function sendNative(message: unknown): void {
  const json = buffer.Buffer.from(JSON.stringify(message), 'utf8');
  const header = buffer.Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function log(...args: unknown[]): void {
  console.error('[cursor-chrome-host]', ...args);
}

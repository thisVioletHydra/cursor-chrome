import type { CommandName, WsRequest, WsResponse } from '@cursor-chrome/protocol';
import type { WebSocket } from 'ws';

import { WS_HOST, WS_PORT } from '@cursor-chrome/protocol';
import { WebSocketServer } from 'ws';

const REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_WAIT_MS = 8_000;
const HEARTBEAT_MS = 20_000;
const PING_TIMEOUT_MS = 5_000;

export class ExtensionBridge {
  private wss: WebSocketServer | undefined;
  private socket: WebSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  async listen(): Promise<void> {
    this.wss = await this.bind();
    this.wss.on('connection', (socket) => {
      if (this.socket && this.socket !== socket) {
        this.socket.close(1000, 'replaced');
        this.socket = undefined;
      }

      this.attach(socket);
    });
    this.startHeartbeat();
  }

  private async bind(): Promise<WebSocketServer> {
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        return await new Promise<WebSocketServer>((resolve, reject) => {
          const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT });
          wss.once('listening', () => resolve(wss));
          wss.once('error', (error) => {
            wss.close();
            reject(error);
          });
        });
      }
      catch (error) {
        const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
        if (!busy || attempt === 14)
          throw busy
            ? new Error(`Port ${WS_PORT} busy. Close the other MCP or kill whatever holds 127.0.0.1:${WS_PORT}.`)
            : error;

        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    throw new Error(`Port ${WS_PORT} busy`);
  }

  get connected(): boolean {
    return this.socket?.readyState === 1;
  }

  async send(method: CommandName, params: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    await this.waitForSocket();
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) {
      throw new Error('Chrome extension is not connected. Load unpacked apps/extension/dist and keep Chrome open.');
    }

    const id = crypto.randomUUID();
    const request: WsRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(request));
    });
  }

  close(): void {
    this.stopHeartbeat();
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(new Error('Bridge closed'));
      this.pending.delete(id);
    }

    this.socket?.close();
    this.wss?.close();
  }

  private attach(socket: WebSocket): void {
    this.socket = socket;
    socket.on('message', (raw) => {
      let message: WsResponse;
      try {
        message = JSON.parse(String(raw)) as WsResponse;
      }
      catch {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending)
        return;

      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.ok)
        pending.resolve(message.result);
      else
        pending.reject(new Error(message.error));
    });
    socket.on('close', () => {
      if (this.socket === socket)
        this.socket = undefined;
    });
    socket.on('error', () => {
      if (this.socket === socket)
        this.socket = undefined;
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.connected === null || this.connected === undefined)
        return;

      void this.send('ping', {}, PING_TIMEOUT_MS).catch(() => {
        try {
          this.socket?.close();
        }
        catch {
        }
      });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null || this.heartbeat === undefined)
      return;

    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private async waitForSocket(): Promise<void> {
    if (this.connected)
      return;

    const started = Date.now();
    while (Date.now() - started < CONNECT_WAIT_MS) {
      if (this.connected)
        return;

      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}

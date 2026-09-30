import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { RawData } from 'ws';

import { watchNote } from '@cursor-chrome/hh';
import { WebSocket, WebSocketServer } from 'ws';
import { extLogin } from './ext-auth';

import process from 'node:process';

const LOST = 'связь с расширением потеряна. Перезагрузи расширение.';
const BACK = 'расширение снова на связи';
const LINK_PATH = '/api/link';
const PING_MS = 30_000;
const AUTH_MS = 5_000;
const TOKEN_MAX = 200;

type LinkHost = {
  on(event: 'upgrade', listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void): void;
};

const linkServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });

let attached = false;
let openSockets = 0;
let lostNoted = false;
// Деплой сервера закрывает сокет. Это не смерть расширения.
let shuttingDown = false;

process.on('SIGTERM', () => {
  shuttingDown = true;
});
process.on('SIGINT', () => {
  shuttingDown = true;
});

export function publishExtLink(): void {
  Object.assign(globalThis, { cursorChromeExtLink: attachExtLink });
}

export function attachExtLink(httpServer: LinkHost): void {
  if (attached)
    return;

  attached = true;
  httpServer.on('upgrade', (request, socket, head) => {
    if (isLinkPath(request) === false)
      return;

    linkServer.handleUpgrade(request, socket, head, (peer) => {
      void acceptPeer(peer).catch(() => {
        peer.close();
      });
    });
  });
}

async function acceptPeer(peer: WebSocket): Promise<void> {
  const token = await firstText(peer);
  if (token === null) {
    peer.close();

    return;
  }

  const login = await extLogin(new Request('http://extension.local/api/link', {
    headers: { authorization: `Bearer ${token}` },
  })).catch(() => null);
  if (login === null) {
    peer.close();

    return;
  }

  if (peer.readyState !== WebSocket.OPEN) {
    noteGone();

    return;
  }

  holdPeer(peer);
}

function holdPeer(peer: WebSocket): void {
  openSockets += 1;
  if (lostNoted) {
    lostNoted = false;
    watchNote('extension', BACK);
  }

  let alive = true;
  const timer = setInterval(() => {
    if (alive === false) {
      clearInterval(timer);
      peer.terminate();

      return;
    }

    alive = false;
    peer.ping();
  }, PING_MS);
  timer.unref?.();
  peer.on('pong', () => {
    alive = true;
  });
  peer.on('close', () => {
    clearInterval(timer);
    openSockets = Math.max(0, openSockets - 1);
    noteGone();
  });
}

function noteGone(): void {
  if (openSockets > 0 || lostNoted || shuttingDown)
    return;

  lostNoted = true;
  watchNote('extension', LOST);
}

function firstText(peer: WebSocket): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finish(null);
    }, AUTH_MS);
    timer.unref?.();

    function finish(token: string | null): void {
      clearTimeout(timer);
      peer.off('message', onMessage);
      peer.off('close', onClose);
      resolve(token);
    }

    function onMessage(data: RawData): void {
      const token = textOf(data).trim();
      finish(token.length > 0 && token.length <= TOKEN_MAX ? token : null);
    }

    function onClose(): void {
      finish(null);
    }

    peer.on('message', onMessage);
    peer.on('close', onClose);
  });
}

function isLinkPath(request: IncomingMessage): boolean {
  const raw = request.url ?? '';
  const path = raw.split('?')[0] ?? '';

  return path === LINK_PATH;
}

function textOf(data: RawData): string {
  if (typeof data === 'string')
    return data;

  if (Array.isArray(data))
    return Buffer.concat(data).toString('utf8');

  return Buffer.from(data).toString('utf8');
}

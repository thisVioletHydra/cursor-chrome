import { getSyncKey, getSyncUrl } from './apply-log';

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

let socket: WebSocket | null = null;
let attempt = 0;
let opening = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function holdExtLink(): void {
  if (socket !== null || timer !== undefined || opening)
    return;

  void openLink();
}

async function openLink(): Promise<void> {
  if (opening)
    return;

  if (socket !== null && socket.readyState !== WebSocket.CLOSED)
    return;

  opening = true;
  try {
    const auth = await linkAuth();
    if (auth === null) {
      planRetry();

      return;
    }

    let next: WebSocket;
    try {
      next = new WebSocket(auth.url);
    }
    catch {
      planRetry();

      return;
    }

    socket = next;
    next.addEventListener('open', () => {
      attempt = 0;
      next.send(auth.key);
    });
    next.addEventListener('close', () => {
      if (socket !== next)
        return;

      socket = null;
      planRetry();
    });
    next.addEventListener('error', () => {
      next.close();
    });
  }
  finally {
    opening = false;
  }
}

function planRetry(): void {
  if (timer !== undefined)
    return;

  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 10_000;
  attempt += 1;
  timer = setTimeout(() => {
    timer = undefined;
    void openLink();
  }, wait);
}

async function linkAuth(): Promise<{ url: string; key: string } | null> {
  const raw = (await getSyncUrl()).trim();
  const key = (await getSyncKey()).trim();
  if (raw.length === 0 || key.length === 0)
    return null;

  try {
    const page = new URL(raw);
    const protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';

    return { url: `${protocol}//${page.host}/api/link`, key };
  }
  catch {
    return null;
  }
}

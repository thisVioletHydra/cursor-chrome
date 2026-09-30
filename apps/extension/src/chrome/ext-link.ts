const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

type LinkTarget = {
  url: string;
  key: string;
};

let socket: WebSocket | null = null;
let link: LinkTarget | null = null;
let attempt = 0;
let opening = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function holdExtLink(origin: string, key: string): void {
  const next = linkTarget(origin, key);
  if (next === null)
    return;

  if (alreadyHolding(next))
    return;

  if (sameLink(next) === false) {
    attempt = 0;
    clearTimer();
    closeSocket();
  }

  link = next;
  startLink();
}

function alreadyHolding(next: LinkTarget): boolean {
  if (sameLink(next) === false)
    return false;

  if (opening || timer !== undefined)
    return true;

  return socket !== null && socket.readyState !== WebSocket.CLOSED;
}

function sameLink(next: LinkTarget): boolean {
  return link !== null && link.url === next.url && link.key === next.key;
}

async function openLink(): Promise<void> {
  if (opening)
    return;

  const target = link;
  if (target === null || (socket !== null && socket.readyState !== WebSocket.CLOSED))
    return;

  opening = true;
  try {
    let next: WebSocket;
    try {
      next = new WebSocket(target.url);
    }
    catch {
      planRetry();

      return;
    }

    socket = next;
    next.addEventListener('open', () => {
      if (socket !== next)
        return;

      attempt = 0;
      next.send(target.key);
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
  catch {
    planRetry();
  }
  finally {
    opening = false;
  }
}

function planRetry(): void {
  if (timer !== undefined || link === null)
    return;

  const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 10_000;
  attempt += 1;
  timer = setTimeout(() => {
    timer = undefined;
    startLink();
  }, wait);
}

function startLink(): void {
  void openLink().catch(() => {
    planRetry();
  });
}

function clearTimer(): void {
  if (timer === undefined)
    return;

  clearTimeout(timer);
  timer = undefined;
}

function closeSocket(): void {
  const current = socket;
  socket = null;
  try {
    current?.close();
  }
  catch {
  }
}

function linkTarget(origin: string, key: string): LinkTarget | null {
  const raw = origin.trim();
  const token = key.trim();
  if (raw.length === 0 || token.length === 0)
    return null;

  try {
    const page = new URL(raw);
    const protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';

    return { url: `${protocol}//${page.host}/api/link`, key: token };
  }
  catch {
    return null;
  }
}

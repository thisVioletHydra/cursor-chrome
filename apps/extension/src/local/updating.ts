// Deploy window: our server answers 502/503/504 or not at all while Railway swaps versions.
// The extension stays a dumb client: show a small «updating» bar, ping /healthz every 3 s, then retry/hide.
// Never submits anything by itself; it only repeats the same read/answer request.
export const UPDATING_TEXT = 'Обновляемся, повторим сами…';
export const PING_MS = 3000;
export const MAX_WAIT_MS = 120_000;

export function isUpdatingStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

type Opts = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; interval?: number; maxWait?: number; onUpdating?: (on: boolean) => void };

const wait = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

export const GONE_TEXT = 'Сервер не найден — вставьте новую ссылку подключения из админки';
export const GIVE_UP_MS = 10 * 60_000;

export type Health = 'ok' | 'down' | 'gone';

// 'gone' = the domain is dead for good (404/410, Railway fallback, 200 without our «ok» body): waiting is useless.
export async function probe(base: string, fetcher: typeof fetch = fetch): Promise<Health> {
  try {
    const res = await fetcher(`${base}/healthz`, { cache: 'no-store' });
    if (res.status === 404 || res.status === 410 || res.headers.get('x-railway-fallback') !== null)
      return 'gone';
    if (res.status !== 200)
      return 'down';
    const body = (await res.text().catch(() => '')).trim();

    // our /healthz says «ok»; anything else with a body (an HTML stub of a foreign/fallback page) = not our server
    return body === '' || body === 'ok' ? 'ok' : 'gone';
  }
  catch {
    return 'down';
  }
}

export async function healthy(base: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  return await probe(base, fetcher) === 'ok';
}

// Pings /healthz every `interval` until 200 or maxWait runs out. true = server is back.
export async function waitHealthy(base: string, opts: Opts = {}): Promise<boolean> {
  const { fetcher = fetch, sleep = wait, interval = PING_MS, maxWait = MAX_WAIT_MS } = opts;
  for (let spent = 0; spent < maxWait; spent += interval) {
    await sleep(interval);
    const state = await probe(base, fetcher);
    if (state === 'ok')
      return true;
    if (state === 'gone')
      return false;
  }

  return false;
}

// Runs a request; on network error / 502 / 503 / 504 waits for /healthz and repeats it once.
export async function retryWhileUpdating(base: string, run: () => Promise<Response>, opts: Opts = {}): Promise<Response> {
  let first: Response;
  try {
    first = await run();
    if (isUpdatingStatus(first.status) === false)
      return first;
  }
  catch (error) {
    if (!base)
      throw error;
    first = new Response(null, { status: 503 });
  }
  if (!base)
    return first;

  opts.onUpdating?.(true);
  try {
    if (await waitHealthy(base, opts) === false)
      return first;

    return await run();
  }
  finally {
    opts.onUpdating?.(false);
  }
}

// popup/options: on open check /healthz; while down show the bar, ping every 3 s, hide and call onBack.
// Dead domain (404/410/fallback) → stop at once with GONE_TEXT; still down after GIVE_UP_MS → same text + «Повторить».
export async function watchUpdating(node: HTMLElement | null, base: string, onBack: () => void = () => {}, opts: Opts = {}): Promise<void> {
  if (node === null || !base)
    return;
  const { fetcher = fetch, sleep = wait, interval = PING_MS, maxWait = GIVE_UP_MS } = opts;
  let state = await probe(base, fetcher);
  if (state === 'ok')
    return;

  node.hidden = false;
  node.className = 'cc-updating';
  node.setAttribute('role', 'status');
  node.textContent = UPDATING_TEXT;
  for (let spent = 0; state === 'down' && spent < maxWait; spent += interval) {
    await sleep(interval);
    state = await probe(base, fetcher);
  }
  if (state === 'ok') {
    node.hidden = true;
    node.textContent = '';
    onBack();

    return;
  }

  node.textContent = GONE_TEXT;
  const again = typeof document === 'undefined' ? null : document.createElement('button');
  if (again !== null) {
    again.type = 'button';
    again.textContent = 'Повторить';
    again.style.marginLeft = '8px';
    again.onclick = () => void watchUpdating(node, base, onBack, opts);
    node.append(again);
  }
}

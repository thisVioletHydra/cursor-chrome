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

export async function healthy(base: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${base}/healthz`, { cache: 'no-store' });

    return res.status === 200;
  }
  catch {
    return false;
  }
}

// Pings /healthz every `interval` until 200 or maxWait runs out. true = server is back.
export async function waitHealthy(base: string, opts: Opts = {}): Promise<boolean> {
  const { fetcher = fetch, sleep = wait, interval = PING_MS, maxWait = MAX_WAIT_MS } = opts;
  for (let spent = 0; spent < maxWait; spent += interval) {
    await sleep(interval);
    if (await healthy(base, fetcher))
      return true;
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
export async function watchUpdating(node: HTMLElement | null, base: string, onBack: () => void = () => {}, opts: Opts = {}): Promise<void> {
  if (node === null || !base)
    return;
  if (await healthy(base, opts.fetcher))
    return;

  node.hidden = false;
  node.className = 'cc-updating';
  node.setAttribute('role', 'status');
  node.textContent = UPDATING_TEXT;
  const back = await waitHealthy(base, { ...opts, maxWait: Number.POSITIVE_INFINITY });
  if (back) {
    node.hidden = true;
    node.textContent = '';
    onBack();
  }
}

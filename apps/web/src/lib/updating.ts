// Admin client: when a fetch to /api fails by network or 502/503/504 (deploy window), show the «updating»
// overlay (same design: iframe of the cached /updating.html, which pings /healthz every 3 s and posts back).
export const DOWN_STATUSES = [502, 503, 504];

export function isApiUrl(input: RequestInfo | URL, origin: string): boolean {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);

    return url.origin === origin && url.pathname.startsWith('/api/');
  }
  catch {
    return false;
  }
}

export function installUpdatingWatch(win: Window & typeof globalThis, show: (on: boolean) => void): () => void {
  const original = win.fetch.bind(win);
  win.fetch = async (input, init) => {
    const api = isApiUrl(input, win.location.origin);
    try {
      const res = await original(input, init);
      if (api && DOWN_STATUSES.includes(res.status))
        show(true);

      return res;
    }
    catch (error) {
      if (api && (error as Error)?.name !== 'AbortError')
        show(true);
      throw error;
    }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin === win.location.origin && event.data?.type === 'nojob-healthy')
      show(false);
  };
  win.addEventListener('message', onMessage);

  return () => {
    win.fetch = original;
    win.removeEventListener('message', onMessage);
  };
}

// Adds the 4-hour access pass (x-access-pass) to every request to our server's /api/* (except /api/access/*)
// and x-ext-version to all of them; reads the server's update flag (x-ext-outdated / 426) from responses.
// No pass yet (legacy extToken accounts) → only the version header is added.
import type { StorageArea } from './store.ts';

import { ACCESS_KEY } from './access.ts';
import { noteUpdate, readUpdateHeaders } from './version.ts';

export function withVersion(input: RequestInfo | URL, init: RequestInit | undefined, base: string, version: string): RequestInit | undefined {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!base || !version || url.startsWith(`${base}/api/`) === false)
    return init;

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-ext-version', version);

  return { ...init, headers };
}

export function withPass(input: RequestInfo | URL, init: RequestInit | undefined, base: string, pass: string): RequestInit | undefined {
  if (!pass || !base)
    return init;

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`${base}/api/`) === false || url.startsWith(`${base}/api/access/`))
    return init;

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-access-pass', pass);

  return { ...init, headers };
}

export function installPassHeader(area: StorageArea, base: () => Promise<string>, onChange?: (listener: () => void) => void, version = ''): void {
  const original = globalThis.fetch.bind(globalThis);
  let pass = '';
  let origin = '';
  const refresh = async () => {
    const state = (await area.get(ACCESS_KEY))[ACCESS_KEY] as { pass?: string; passExpires?: number } | undefined;
    pass = state?.pass && (state.passExpires ?? 0) > Date.now() ? state.pass : '';
    origin = await base();
  };
  void refresh();
  onChange?.(() => void refresh());
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, withVersion(input, withPass(input, init, origin, pass), origin, version));
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (origin && url.startsWith(`${origin}/api/`))
      void noteUpdate(area, readUpdateHeaders(res.headers, res.status)).catch(() => null);

    return res;
  };
}

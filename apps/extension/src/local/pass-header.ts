// Adds the 4-hour access pass (x-access-pass) to every request to our server's /api/* (except /api/access/*).
// No pass yet (legacy extToken accounts) → requests go out unchanged.
import type { StorageArea } from './store.ts';

import { ACCESS_KEY } from './access.ts';

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

export function installPassHeader(area: StorageArea, base: () => Promise<string>, onChange?: (listener: () => void) => void): void {
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
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => original(input, withPass(input, init, origin, pass));
}

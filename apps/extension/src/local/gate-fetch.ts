// One guard for every request to our server's /api/* (background, content scripts, pages):
// gate closed → no request at all (synthetic 503 «paused»); server answers 401/403 → gate becomes «unauthorized»
// at once (popup → connect screen, badge «!», queue/autopilot loops stop). Only /api/link and /api/access/* pass
// while closed (they are how the link gets re-checked). Writes only its own linkGate key.
import { checkLink, gateOpen, LINK_GATE_KEY, type LinkGate } from './link-gate.ts';

type Area = { get: (keys: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> };

export const PAUSED_BODY = { ok: false, paused: true, error: 'нет связи с админкой' };
const ALWAYS = ['/api/link', '/api/access/', '/api/ext/'];

export function apiPath(url: string, origin: string): string | null {
  if (!origin || url.startsWith(`${origin}/api/`) === false)
    return null;

  return url.slice(origin.length).split('?')[0];
}

export function passesClosedGate(path: string): boolean {
  return ALWAYS.some(prefix => path === prefix || path.startsWith(prefix));
}

export function unauthorizedGate(prev: LinkGate | null, host: string, now = Date.now()): LinkGate {
  return { ...(prev ?? {}), state: 'unauthorized', host: prev?.host || host, at: now, fails: (prev?.fails ?? 0) + 1 };
}

// a live failure on an open gate: close it now (popup → connect screen, queue/pulse stop), re-check in 2 s
export function lostGate(prev: LinkGate | null, host: string, now = Date.now()): LinkGate {
  return { state: 'down', host: prev?.host || host, at: now, fails: 1, fast: true, ...(prev?.login ? { login: prev.login } : {}) };
}
export const LOST_STATUSES = [502, 503, 504];

export function makeGateFetch(original: typeof fetch, area: Area, origin: () => string, now = Date.now): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const base = origin();
    const path = apiPath(url, base);
    if (path === null)
      return original(input, init);
    const stored: Record<string, unknown> = await area.get(LINK_GATE_KEY).catch(() => ({}));
    const gate = (stored[LINK_GATE_KEY] ?? null) as LinkGate | null;
    if (passesClosedGate(path) === false && gateOpen(gate, now()) === false)
      return new Response(JSON.stringify(PAUSED_BODY), { status: 503, headers: { 'content-type': 'application/json', 'x-cc-paused': '1' } });
    const markLost = async () => {
      const cur = ((await area.get(LINK_GATE_KEY).catch(() => ({})))[LINK_GATE_KEY] ?? null) as LinkGate | null;
      if (gateOpen(cur, now())) {
        const key = (await area.get('applySyncKey')).applySyncKey;
        // Confirm using a read-only request; never retry the original mutation.
        if (typeof key === 'string' && key) {
          const checked = await checkLink(base, key, original);
          if (checked.state === 'ok') return;
          await area.set({ [LINK_GATE_KEY]: { ...checked, login: cur?.login, fails: 3 } });
        } else {
          await area.set({ [LINK_GATE_KEY]: lostGate(cur, new URL(base).host, now()) }).catch(() => {});
        }
      }
    };
    let res: Response;
    try {
      res = await original(input, init);
    }
    catch (error) {
      await markLost();
      throw error;
    }
    if (LOST_STATUSES.includes(res.status) && res.headers.get('x-cc-paused') === null)
      await markLost();
    if ((res.status === 401 || res.status === 403) && path !== '/api/link' && path.startsWith('/api/access/') === false)
      await area.set({ [LINK_GATE_KEY]: unauthorizedGate(gate, new URL(base).host, now()) }).catch(() => {});

    return res;
  };
}

// Installs the guard on globalThis.fetch. origin: the stored server (kept fresh by the caller).
export function installGateFetch(area: Area, readOrigin: () => Promise<string>, onChange?: (listener: () => void) => void): void {
  let origin = '';
  const refresh = async () => {
    try {
      const u = new URL((await readOrigin()).trim());
      origin = `${u.protocol}//${u.host}`;
    }
    catch {
      origin = '';
    }
  };
  void refresh();
  onChange?.(() => void refresh());
  globalThis.fetch = makeGateFetch(globalThis.fetch.bind(globalThis), area, () => origin);
}

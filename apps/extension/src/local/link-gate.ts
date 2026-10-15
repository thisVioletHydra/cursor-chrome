// Gate «без синка — пауза»: the extension acts on sites only while it is linked to the admin
// (connect link + extToken stored AND the server accepted an authorized request recently).
// Never deletes local data and never renames storage keys; it only writes its own LINK_GATE_KEY.
import { SERVER_STEPS_MS, stepAt } from '../link/backoff.ts';

export const LINK_GATE_KEY = 'linkGate';
export const LINK_OK_TTL_MS = 3 * 60_000;
export const NOT_LINKED_TEXT = 'Не подключено к админке';
export const RELINK_TEXT = 'Переподключи расширение: вставь новую ссылку из админки';

export type LinkState = 'ok' | 'none' | 'gone' | 'unauthorized' | 'down';
// login: account of the extToken as the server reported it (optional, old gates have none)
// fast: closed by a live failure (network error / 502-504 seen by the fetch guard); first re-check in FAST_PROBE_MS
export type LinkGate = { state: LinkState; host: string; at: number; login?: string; fails?: number; fast?: boolean };
export const FAST_PROBE_MS = 2000;

export function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host;
  }
  catch {
    return '';
  }
}

// One authorized GET /api/link with the extToken. 404/fallback → gone, 401/403 → unauthorized, network/5xx → down.
export async function checkLink(url: string, key: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<LinkGate> {
  const host = hostOf(url);
  if (host.length === 0 || key.trim().length === 0)
    return { state: 'none', host, at: now };

  const base = `${new URL(url.trim()).protocol}//${host}`;
  // Three bounded observations: immediate HTTP errors take 10 s, stalled requests at most 19 s.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetcher(`${base}/api/link`, { cache: 'no-store', signal: controller.signal, headers: { authorization: `Bearer ${key.trim()}` } });
      if (res.status === 200) {
        const body = await res.json() as { login?: unknown };
        const login = typeof body?.login === 'string' ? body.login : '';
        return { state: 'ok', host, at: Date.now(), ...(login ? { login } : {}) };
      }
      if (res.status === 401 || res.status === 403)
        return { state: 'unauthorized', host, at: Date.now() };
      if (res.status === 404 || res.status === 410 || res.headers.get('x-railway-fallback') !== null)
        return { state: 'gone', host, at: Date.now() };
    } catch {} finally { clearTimeout(timer); }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  return { state: 'down', host, at: Date.now() };
}

export function gateOpen(gate: LinkGate | null | undefined, now = Date.now()): boolean {
  return gate?.state === 'ok' && now - gate.at < LINK_OK_TTL_MS;
}

export function gateText(gate: LinkGate | null | undefined): string {
  if (gate === null || gate === undefined || gate.state === 'none')
    return NOT_LINKED_TEXT;
  if (gate.state === 'gone' || gate.state === 'unauthorized')
    return RELINK_TEXT;
  if (gate.state === 'down')
    return `${NOT_LINKED_TEXT}: сервер не отвечает, пауза`;

  return '';
}

export function serverLine(gate: LinkGate | null | undefined): string {
  return gate?.host ? `Сервер: ${gate.host}` : 'Сервер: не задан';
}

type Area = { get: (keys: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> };

export async function readGate(area: Area): Promise<LinkGate | null> {
  const raw = (await area.get(LINK_GATE_KEY))[LINK_GATE_KEY] as LinkGate | undefined;

  return raw && typeof raw.state === 'string' ? raw : null;
}

export async function refreshGate(area: Area, url: string, key: string, fetcher: typeof fetch = fetch, prev: LinkGate | null = null): Promise<LinkGate> {
  const checked = await checkLink(url, key, fetcher);
  // failures in a row (own field inside linkGate): drives the growing probe interval
  // an open gate that fails its own check is «lost» at once with a quick 2 s re-check (same as the fetch guard)
  const lost = checked.state === 'down' && gateOpen(prev);
  const gate = checked.state === 'ok' ? checked : lost ? { ...checked, fails: 1, fast: true } : { ...checked, fails: (prev?.fails ?? 0) + 1 };
  await area.set({ [LINK_GATE_KEY]: gate });

  return gate;
}

// Background probe schedule: open gate → refresh at half TTL; closed → 30 s, 1, 2, 4, 8, 15 min (cap).
// User actions («Подключить», popup open, new link saved) call checkLink/refreshGate directly, bypassing this.
export function probeDue(gate: LinkGate | null | undefined, now = Date.now()): boolean {
  if (gate === null || gate === undefined)
    return true;
  if (gate.state === 'none')
    return false; // nothing to probe until the user pastes a key
  if (gate.state === 'ok')
    return now - gate.at >= LINK_OK_TTL_MS / 2;
  if (gate.fast === true)
    return now - gate.at >= FAST_PROBE_MS;

  return now - gate.at >= stepAt(SERVER_STEPS_MS, Math.max(1, gate.fails ?? 1));
}

// Popup: stored server and the gate's server differ → the link is stale, ask to relink.
export function serverMismatch(gate: LinkGate | null | undefined, syncUrl: string): boolean {
  const synced = hostOf(syncUrl);

  return Boolean(gate?.host) && synced.length > 0 && gate?.host !== synced;
}

// Admin URL for the «Открыть админку» button; empty when there is no server yet.
// Scheme comes from the stored sync URL when it is the same host (http for localhost dev), else https.
export function adminUrl(gate: LinkGate | null | undefined, syncUrl = ''): string {
  if (!gate?.host)
    return '';
  let scheme = 'https:';
  try {
    const u = new URL(syncUrl.trim());
    if (u.host === gate.host)
      scheme = u.protocol;
  }
  catch {
  }

  return `${scheme}//${gate.host}/admin`;
}

// Messages that act on sites (open/drive tabs, autofill, queue, negotiations sync): refused while the gate is closed.
export const GATED_MESSAGES = ['run-queue', 'sync-negotiations', 'open-hh', 'hh-same-tab', 'ensure-hh', 'open-worker-url', 'pull-resume', 'answer-question', 'pin-tab', 'command', 'make-good', 'run-apply'] as const;

export function isGatedMessage(type: string): boolean {
  return (GATED_MESSAGES as readonly string[]).includes(type);
}

export const PAUSED_REPLY = { ok: false, paused: true, status: 'skip', reason: NOT_LINKED_TEXT, error: NOT_LINKED_TEXT };

// Content scripts: read the gate the worker keeps fresh; closed/missing/stale → no actions on the page.
export async function contentGateOpen(area: Pick<Area, 'get'>, now = Date.now()): Promise<boolean> {
  try {
    return gateOpen(await readGate(area as Area), now);
  }
  catch {
    return false;
  }
}

// ── Bind mode («режим привязки»): while the gate is closed the popup shows only the connect screen.
export const BIND_TITLE = 'Введи ключ для связи';
export const DEFAULT_ADMIN_URL = 'https://nojobnoproblem.up.railway.app/admin';

// Popup first paint: trust the stored state (not the TTL) to avoid a flash; the live check decides after.
export function bindMode(gate: LinkGate | null | undefined, now = Date.now(), strict = true): boolean {
  if (strict)
    return gateOpen(gate, now) === false;

  return gate?.state !== 'ok';
}

// «Подключить»: a connect link (https://host/connect#key) or a bare key for the already known server.
export function parseConnectInput(raw: string, knownUrl = ''): { url: string; key: string } | null {
  const text = raw.trim();
  if (text.length === 0)
    return null;
  try {
    const link = new URL(text);
    if (link.pathname.replace(/\/+$/, '') !== '/connect')
      return null;
    const key = decodeURIComponent(link.hash.replace(/^#/, '')).trim();

    return key.length >= 16 ? { url: `${link.protocol}//${link.host}`, key } : null;
  }
  catch {
  }
  if (/^[\w.~+/=-]{16,}$/.test(text) === false)
    return null;
  try {
    const known = new URL(knownUrl.trim());

    return { url: `${known.protocol}//${known.host}`, key: text };
  }
  catch {
    return null;
  }
}

// open → closed = 'lost' (autopilot pauses, popup back to the connect screen); closed → open = 'linked'.
export function gateTransition(prev: LinkGate | null | undefined, next: LinkGate | null | undefined, now = Date.now()): 'linked' | 'lost' | null {
  const was = gateOpen(prev, now);
  const is = gateOpen(next, now);
  if (was === is)
    return null;

  return is ? 'linked' : 'lost';
}

// Admin «До старта»: the content script leaves a mark on our admin page only (never on job sites),
// so the admin tells «не установлено» (no mark) from «установлено, но не связано» (mark = unlinked).
export const BIND_MARK_ATTR = 'data-nojob-ext';
export const BIND_MARK_EVENT = 'nojob-ext-mark';
export const ADMIN_META = 'nojob-admin';

export function bindMark(gate: LinkGate | null | undefined, now = Date.now()): 'linked' | 'unlinked' {
  return gateOpen(gate, now) ? 'linked' : 'unlinked';
}

function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin;
  }
  catch {
    return '';
  }
}

// Origins allowed to receive the mark: admin of the gate host and the sync URL; nothing known → DEFAULT_ADMIN_URL.
export function markOrigins(gate: LinkGate | null | undefined, syncUrl = ''): string[] {
  const list = [originOf(adminUrl(gate, syncUrl)), originOf(syncUrl)].filter(o => o.length > 0);

  return list.length > 0 ? list : [originOf(DEFAULT_ADMIN_URL)];
}

export function shouldMarkPage(pageOrigin: string, path: string, hasAdminMeta: boolean, origins: string[]): boolean {
  // our admin only: own origin AND /admin path AND the <meta name="nojob-admin"> the admin page renders
  return origins.includes(pageOrigin) && path.startsWith('/admin') && hasAdminMeta;
}

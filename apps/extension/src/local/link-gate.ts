// Gate «без синка — пауза»: the extension acts on sites only while it is linked to the admin
// (connect link + extToken stored AND the server accepted an authorized request recently).
// Never deletes local data and never renames storage keys; it only writes its own LINK_GATE_KEY.
import { probe } from './updating.ts';

export const LINK_GATE_KEY = 'linkGate';
export const LINK_OK_TTL_MS = 3 * 60_000;
export const NOT_LINKED_TEXT = 'Не подключено к админке';
export const RELINK_TEXT = 'Переподключи расширение: вставь новую ссылку из админки';

export type LinkState = 'ok' | 'none' | 'gone' | 'unauthorized' | 'down';
export type LinkGate = { state: LinkState; host: string; at: number };

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
  try {
    const res = await fetcher(`${base}/api/link`, { cache: 'no-store', headers: { authorization: `Bearer ${key.trim()}` } });
    if (res.status === 200)
      return { state: 'ok', host, at: now };
    if (res.status === 401 || res.status === 403)
      return { state: 'unauthorized', host, at: now };
    if (res.status === 404 || res.status === 410 || res.headers.get('x-railway-fallback') !== null)
      return { state: 'gone', host, at: now };
  }
  catch {
  }
  const health = await probe(base, fetcher);

  return { state: health === 'gone' ? 'gone' : 'down', host, at: now };
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

export async function refreshGate(area: Area, url: string, key: string, fetcher: typeof fetch = fetch): Promise<LinkGate> {
  const gate = await checkLink(url, key, fetcher);
  await area.set({ [LINK_GATE_KEY]: gate });

  return gate;
}

// Admin URL for the «Открыть админку» button; empty when there is no server yet.
export function adminUrl(gate: LinkGate | null | undefined): string {
  return gate?.host ? `https://${gate.host}/admin` : '';
}

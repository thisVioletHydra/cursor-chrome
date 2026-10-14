// Access token + deviceId + 4-hour check-in. Token and pass live only in chrome.storage.local.
import type { StorageArea } from './store.ts';
import type { RawSignals } from './fingerprint.ts';

export const ACCESS_KEY = 'access:v1';
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export type AccessState = {
  token: string;
  deviceId: string;
  pass: string;
  passExpires: number;
  last: null | { at: number; status: number; score: number; zone: string | null; reason: string; slot: number | null; perSignal: Record<string, boolean>; sent: unknown };
  log: Array<{ at: number; text: string }>;
  fontsCache?: string;
};

export function newDeviceId(): string {
  return crypto.randomUUID();
}

export async function loadAccess(area: StorageArea): Promise<AccessState> {
  const got = (await area.get(ACCESS_KEY))[ACCESS_KEY] as Partial<AccessState> | undefined;
  const state: AccessState = { token: '', deviceId: '', pass: '', passExpires: 0, last: null, log: [], ...got };
  if (!state.deviceId) {
    state.deviceId = newDeviceId();
    await area.set({ [ACCESS_KEY]: state });
  }

  return state;
}

export async function saveAccess(area: StorageArea, state: AccessState): Promise<void> {
  await area.set({ [ACCESS_KEY]: { ...state, log: state.log.slice(-50) } });
}

export function needsCheck(state: AccessState, now = Date.now()): boolean {
  return state.token.length > 0 && (state.pass.length === 0 || state.passExpires - now < 5 * 60_000 || (state.last?.at ?? 0) + CHECK_EVERY_MS <= now);
}

// Full check: sends raw signals; the server normalizes, hashes and scores them (token only in the header).
export async function checkIn(area: StorageArea, base: string, raw: RawSignals, fetcher: typeof fetch = fetch, now = Date.now()): Promise<AccessState> {
  const state = await loadAccess(area);
  if (!state.token || !base)
    return state;

  const sent = { raw };
  let status = 0;
  let body: Record<string, unknown> = {};
  try {
    const res = await fetcher(`${base}/api/access/check`, { method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }, body: JSON.stringify(sent) });
    status = res.status;
    body = await res.json().catch(() => ({})) as Record<string, unknown>;
  }
  catch {
    body = { reason: 'сервер недоступен' };
  }
  const ok = status === 200 && typeof body.pass === 'string';
  const next: AccessState = {
    ...state,
    pass: ok ? String(body.pass) : status === 0 ? state.pass : '',
    passExpires: ok ? Number(body.passExpires) : status === 0 ? state.passExpires : 0,
    last: { at: now, status, score: Number(body.score ?? 0), zone: (body.zone as string) ?? null, reason: String(body.reason ?? ''), slot: (body.slot as number) ?? null, perSignal: (body.perSignal as Record<string, boolean>) ?? {}, sent },
    fontsCache: raw.fonts || state.fontsCache,
    log: [...state.log, { at: now, text: `check ${status}: ${String(body.reason ?? '')}${body.slot ? ` · слот ${String(body.slot)}` : ''} · скор ${String(body.score ?? 0)}` }],
  };
  await saveAccess(area, next);

  return next;
}

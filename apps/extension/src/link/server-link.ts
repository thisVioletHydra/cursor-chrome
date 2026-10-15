// Stage B client: server → extension commands over long-poll.
// GET /api/ext/next (server holds up to 25 s) → run one primitive → POST /api/ext/report.
// Runs only while the link gate is open; 401/403 stops it; network/5xx → growing backoff (30 s … 15 min).
// Idle/stop answers from the planner are honoured as pauses. Nothing happens on sites until a command arrives.
// Auth: Bearer extToken; x-access-pass/x-ext-version are added by the pass-header fetch wrapper.
import { makeBackoff, MAX_STEP_MS, SERVER_STEPS_MS } from './backoff.ts';

export const CMD_KINDS = ['navigate', 'click', 'type', 'select', 'press_key', 'read', 'snapshot', 'wait', 'hh_apply'] as const;
export type CmdKind = (typeof CMD_KINDS)[number];
export type Wire = { id: string; kind: CmdKind; params: Record<string, unknown>; deadline?: number };
export type Outcome = { ok: true; result: unknown } | { ok: false; error: string };
export type PlanPause = { type: 'idle'; reason: string; retryMs: number } | { type: 'stop'; reason: string; needsHuman?: boolean };

export type LinkDeps = {
  base: () => Promise<string>;
  key: () => Promise<string>;
  gateOpen: () => Promise<boolean>;
  exec: (cmd: Wire) => Promise<Outcome>;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onUnauthorized?: () => void | Promise<void>;
  onPause?: (pause: PlanPause) => void | Promise<void>;
  maxRounds?: number;
};

export type LoopEnd = 'closed' | 'unauthorized' | 'no-server' | 'rounds';

export function httpsOnly(url: unknown): string | null {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:' ? u.href : null;
  }
  catch {
    return null;
  }
}

// popup open (or any wake) cuts the current sleep short so a freshly enabled flag is picked up at once
const sleepers = new Set<() => void>();
export function wakeServerLink(): void {
  for (const done of [...sleepers]) done();
  sleepers.clear();
}
export function wakeableSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    sleepers.add(done);
  });
}
export function nextAfterMs(res: Response): number | null {
  const raw = res.headers.get('x-next-after');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_STEP_MS, Math.max(1000, n)) : null;
}

const QUICK_MS = 1000; // a 204 faster than this = the server did not hold the poll → back off

export function isWire(body: unknown): body is Wire {
  const b = body as Partial<Wire> | null;
  return b !== null && typeof b === 'object' && typeof b.id === 'string' && typeof b.kind === 'string' && (CMD_KINDS as readonly string[]).includes(b.kind) && typeof b.params === 'object' && b.params !== null;
}

export function isPause(body: unknown): body is PlanPause {
  const b = body as { type?: unknown } | null;
  return b !== null && typeof b === 'object' && (b.type === 'idle' || b.type === 'stop');
}

export function pauseMs(p: PlanPause): number {
  if (p.type === 'stop')
    return MAX_STEP_MS;

  return Math.min(MAX_STEP_MS, Math.max(1000, Number.isFinite(p.retryMs) ? p.retryMs : 60_000));
}

export async function serverLinkLoop(d: LinkDeps): Promise<LoopEnd> {
  const fetcher = d.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = d.sleep ?? wakeableSleep;
  const now = d.now ?? Date.now;
  const backoff = makeBackoff(SERVER_STEPS_MS);
  const max = d.maxRounds ?? Number.POSITIVE_INFINITY;
  for (let round = 0; round < max; round += 1) {
    if (await d.gateOpen() === false)
      return 'closed';
    const base = (await d.base()).trim().replace(/\/+$/, '');
    const key = (await d.key()).trim();
    if (!base || !key)
      return 'closed';
    const auth = { authorization: `Bearer ${key}` };
    const started = now();
    let res: Response;
    try {
      res = await fetcher(`${base}/api/ext/next`, { cache: 'no-store', headers: auth });
    }
    catch {
      await sleep(backoff.next());
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      await d.onUnauthorized?.();
      return 'unauthorized';
    }
    if (res.status === 404 || res.status === 410)
      return 'no-server'; // server without stage B: stop quietly, gate reopen restarts us
    if (res.status === 204) {
      const after = nextAfterMs(res);
      if (after !== null) { // flag off on the server: come back later (popup open wakes us earlier)
        backoff.reset();
        await sleep(after);
        continue;
      }
      if (now() - started < QUICK_MS)
        await sleep(backoff.next());
      else
        backoff.reset();
      continue;
    }
    if (res.status !== 200) {
      await sleep(backoff.next());
      continue;
    }
    const body = await res.json().catch(() => null) as unknown;
    backoff.reset();
    if (isPause(body)) {
      await d.onPause?.(body);
      await sleep(pauseMs(body));
      continue;
    }
    if (isWire(body) === false) {
      await sleep(backoff.next());
      continue;
    }
    // the gate may have closed while we were waiting: never act on the site then
    const out: Outcome = await d.gateOpen() === false
      ? { ok: false, error: 'нет связи с админкой' }
      : await d.exec(body).catch(error => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
    const report = out.ok ? { id: body.id, ok: true, result: out.result ?? null } : { id: body.id, ok: false, error: String(out.error || 'ошибка').slice(0, 2000) };
    try {
      const sent = await fetcher(`${base}/api/ext/report`, { method: 'POST', cache: 'no-store', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(report) });
      if (sent.status === 401 || sent.status === 403) {
        await d.onUnauthorized?.();
        return 'unauthorized';
      }
    }
    catch {
      await sleep(backoff.next());
    }
  }

  return 'rounds';
}

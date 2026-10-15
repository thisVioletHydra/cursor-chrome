// Stage B transport: server → extension commands. In-memory only, per account, no timers left
// running without a waiter, no background loops. A command of one login never reaches another.
import crypto from 'node:crypto';
import type { CommandJournal } from './command-journal.ts';

import { commandJournal } from './command-journal.ts';

export const KINDS = ['readDOM', 'navigate', 'click', 'type', 'select', 'press_key', 'read', 'snapshot', 'wait', 'hh_apply'] as const;
export type Kind = (typeof KINDS)[number];

export interface Cmd { kind: Kind; params: Record<string, unknown> }
export interface Wire extends Cmd { id: string; deadline: number }
export type Outcome = { ok: true; result: unknown } | { ok: false; error: string };

export const LIMITS = {
  pollMs: 25_000,
  queueTtlMs: 60_000, // waiting in queue before anyone picked it up
  execMs: 45_000, // default time to report after pickup
  maxExecMs: 120_000,
  maxQueue: 20,
  maxResultBytes: 256 * 1024,
  maxText: 4_000,
};

const str = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max = 1000) => v === undefined || str(v, max);
const optNum = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);

// Returns an error text or null. Unknown fields are rejected so the contract stays explicit.
export function validate(cmd: unknown): string | null {
  if (cmd === null || typeof cmd !== 'object')
    return 'команда не объект';
  const { kind, params } = cmd as { kind?: unknown; params?: unknown };
  if (typeof kind !== 'string' || (KINDS as readonly string[]).includes(kind) === false)
    return 'неизвестный kind';
  if (params === null || typeof params !== 'object' || Array.isArray(params))
    return 'params не объект';
  const p = params as Record<string, unknown>;
  const allow: Record<Kind, string[]> = {
    readDOM: ['mode', 'selector', 'attr', 'all', 'maxChars'],
    navigate: ['url'],
    click: ['selector', 'timeoutMs'],
    type: ['selector', 'text', 'submit', 'clear', 'timeoutMs'],
    select: ['selector', 'values', 'timeoutMs'],
    press_key: ['key', 'selector'],
    read: ['selector', 'attr', 'all', 'maxChars'],
    snapshot: ['selector', 'maxChars'],
    wait: ['selector', 'ms', 'timeoutMs', 'gone'],
    hh_apply: ['vacancyId', 'letter', 'answers'],
  };
  const extra = Object.keys(p).filter((k) => allow[kind as Kind].includes(k) === false);
  if (extra.length > 0)
    return `лишние поля: ${extra.join(',')}`;
  if (optNum(p.timeoutMs, 0, LIMITS.maxExecMs) === false)
    return 'timeoutMs вне 0..120000';
  switch (kind as Kind) {
    case 'readDOM':
      if (p.mode !== 'snapshot' && p.mode !== 'text') return 'mode snapshot/text';
      if (!optStr(p.selector) || !optStr(p.attr, 100)) return 'selector/attr';
      return optNum(p.maxChars, 1, 100_000) ? null : 'maxChars';
    case 'navigate': {
      if (str(p.url, 2000) === false)
        return 'url обязателен';
      let u: URL;
      try { u = new URL(p.url as string); }
      catch { return 'url кривой'; }
      return u.protocol === 'https:' ? null : 'url только https';
    }
    case 'click':
      return str(p.selector) ? null : 'selector обязателен';
    case 'type':
      if (str(p.selector) === false)
        return 'selector обязателен';
      if (typeof p.text !== 'string' || p.text.length > 20_000)
        return 'text обязателен (до 20000)';
      if (p.submit !== undefined && typeof p.submit !== 'boolean')
        return 'submit boolean';
      return p.clear === undefined || typeof p.clear === 'boolean' ? null : 'clear boolean';
    case 'select':
      if (str(p.selector) === false)
        return 'selector обязателен';
      return Array.isArray(p.values) && p.values.length > 0 && p.values.length <= 50 && p.values.every((v) => str(v, 500)) ? null : 'values: массив строк';
    case 'press_key':
      if (str(p.key, 40) === false)
        return 'key обязателен';
      return optStr(p.selector) ? null : 'selector строка';
    case 'read':
      if (str(p.selector) === false)
        return 'selector обязателен';
      if (optStr(p.attr, 100) === false || (p.all !== undefined && typeof p.all !== 'boolean'))
        return 'attr/all кривые';
      return optNum(p.maxChars, 1, LIMITS.maxText) ? null : `maxChars 1..${LIMITS.maxText}`;
    case 'snapshot':
      if (optStr(p.selector) === false)
        return 'selector строка';
      return optNum(p.maxChars, 1, 100_000) ? null : 'maxChars 1..100000';
    case 'wait':
      if (p.selector === undefined && p.ms === undefined)
        return 'нужен selector или ms';
      if (optStr(p.selector) === false || optNum(p.ms, 0, 60_000) === false)
        return 'selector/ms кривые';
      return p.gone === undefined || typeof p.gone === 'boolean' ? null : 'gone boolean';
    case 'hh_apply':
      if (str(p.vacancyId, 20) === false || /^\d+$/.test(p.vacancyId as string) === false)
        return 'vacancyId: цифры';
      if (p.letter !== undefined && (typeof p.letter !== 'string' || p.letter.length > 10_000))
        return 'letter до 10000';
      return p.answers === undefined || (p.answers !== null && typeof p.answers === 'object' && Array.isArray(p.answers) === false) ? null : 'answers объект';
  }
}

interface Pending { wire: Wire; queuedAt: number; execMs: number; picked: boolean; holder: string; done: (o: Outcome) => void; timer?: ReturnType<typeof setTimeout> }
interface Poller { id: number; resolve: (w: Wire | null) => void; timer: ReturnType<typeof setTimeout> }
interface Box { queue: Pending[]; inflight: Map<string, Pending>; poller: Poller | null }

export interface BusOpts { now?: () => number; limits?: Partial<typeof LIMITS>; log?: (line: string) => void; journal?: CommandJournal }

// Journal row: ids and states only. No params, texts, answers or results ever reach the disk.
export type JournalStatus = 'queued' | 'sent' | 'done' | 'lost';
export interface JournalRow { login: string; id: string; kind: string; status: JournalStatus; at: number }
const KEEP_MS = 86_400_000;
const HOLDER = /^[\w:.-]{1,100}$/;

// After a restart nothing can be re-sent (params are not stored): every unfinished command becomes lost.
// v1 journals (with params) are converted the same way and rewritten without params.
function loadRows(raw: unknown): JournalRow[] {
  const saved = raw as { version?: number; rows?: JournalRow[]; pending?: { login: string; wire: { id: string; kind: string } }[]; completed?: { login: string; id: string; at: number }[] } | null;
  if (saved === null || typeof saved !== 'object')
    return [];
  if (saved.version === 1) {
    const done = (saved.completed ?? []).map(r => ({ login: r.login, id: r.id, kind: '', status: 'done' as const, at: r.at }));
    const lost = (saved.pending ?? []).map(r => ({ login: r.login, id: r.wire.id, kind: r.wire.kind, status: 'lost' as const, at: Date.now() }));

    return [...done, ...lost];
  }

  if (saved.version !== 2)
    throw new Error('unsupported command journal');

  return (saved.rows ?? []).map(r => ({ login: r.login, id: r.id, kind: r.kind, at: r.at, status: r.status === 'done' ? 'done' : 'lost' }));
}

export function createBus(opts: BusOpts = {}) {
  const now = opts.now ?? Date.now;
  const L = { ...LIMITS, ...opts.limits };
  const log = opts.log ?? ((line: string) => console.info(line));
  const boxes = new Map<string, Box>();
  let pollSeq = 0;
  const key = (login: string, id: string) => JSON.stringify([login, id]);
  const rows = new Map<string, JournalRow>();
  const mark = (login: string, wire: { id: string; kind: string }, status: JournalStatus) => {
    rows.set(key(login, wire.id), { login, id: wire.id, kind: wire.kind, status, at: now() });
    persist();
  };
  const persist = () => {
    for (const [k, row] of rows) if (now() - row.at > KEEP_MS) rows.delete(k);
    if (opts.journal === undefined)
      return;

    opts.journal.save({ version: 2, rows: [...rows.values()] });
  };
  if (opts.journal !== undefined) {
    const raw = opts.journal.load() as { version?: number; rows?: JournalRow[] } | null;
    for (const row of loadRows(raw)) rows.set(key(row.login, row.id), row);
    // rewrite only when something changed: v1 (with params) or unfinished rows turned lost
    if (raw !== null && (raw.version !== 2 || (raw.rows ?? []).some(r => r.status !== 'done' && r.status !== 'lost')))
      persist();
  }

  const box = (login: string): Box => {
    let b = boxes.get(login);
    if (b === undefined) {
      b = { queue: [], inflight: new Map(), poller: null };
      boxes.set(login, b);
    }
    return b;
  };
  const tidy = (login: string) => {
    const b = boxes.get(login);
    if (b !== undefined && b.queue.length === 0 && b.inflight.size === 0 && b.poller === null)
      boxes.delete(login);
  };
  // drop queued commands nobody picked up in time (lazy, on every touch)
  const expire = (login: string, b: Box) => {
    const t = now();
    b.queue = b.queue.filter((p) => {
      if (t - p.queuedAt <= L.queueTtlMs)
        return true;
      log(`ext-cmd ${login} ${p.wire.kind} ${p.wire.id} expired`);
      mark(login, p.wire, 'lost');
      p.done({ ok: false, error: 'истёк TTL: расширение не забрало команду' });
      return false;
    });
  };
  // lease: a picked command belongs to the holder (extension tab) that took it
  const pick = (login: string, b: Box, holder: string): Wire | null => {
    const p = b.queue.shift();
    if (p === undefined)
      return null;
    p.picked = true;
    p.holder = holder;
    p.wire.deadline = now() + p.execMs;
    b.inflight.set(p.wire.id, p);
    mark(login, p.wire, 'sent');
    p.timer = setTimeout(() => {
      if (b.inflight.delete(p.wire.id)) {
        log(`ext-cmd ${login} ${p.wire.kind} ${p.wire.id} timeout`);
        mark(login, p.wire, 'lost');
        p.done({ ok: false, error: 'таймаут выполнения' });
        tidy(login);
      }
    }, p.execMs);
    p.timer.unref?.();
    log(`ext-cmd ${login} ${p.wire.kind} ${p.wire.id} sent`);
    return p.wire;
  };
  // re-poll of the same holder (lost response) gets its own leased command again; other holders never do
  const leased = (b: Box, holder: string): Wire | null => {
    if (holder === '')
      return null;

    for (const p of b.inflight.values())
      if (p.holder === holder && p.wire.deadline > now()) return p.wire;

    return null;
  };

  function enqueue(login: string, cmd: Cmd, o: { execMs?: number } = {}): Promise<Outcome> {
    if (str(login, 100) === false)
      return Promise.reject(new Error('нет login'));
    const bad = validate(cmd);
    if (bad !== null)
      return Promise.reject(new Error(`команда отклонена: ${bad}`));
    const b = box(login);
    expire(login, b);
    if (b.queue.length >= L.maxQueue)
      return Promise.reject(new Error('очередь переполнена'));
    const execMs = Math.min(o.execMs ?? L.execMs, L.maxExecMs);
    return new Promise<Outcome>((resolve) => {
      const wire: Wire = { id: crypto.randomUUID(), kind: cmd.kind, params: structuredClone(cmd.params), deadline: 0 };
      b.queue.push({ wire, queuedAt: now(), execMs, picked: false, holder: '', done: resolve });
      mark(login, wire, 'queued');
      log(`ext-cmd ${login} ${cmd.kind} ${wire.id} queued`);
      if (b.poller !== null) {
        const pl = b.poller;
        b.poller = null;
        clearTimeout(pl.timer);
        pl.resolve(pick(login, b, pollHolder.get(login) ?? ''));
      }
    });
  }

  const pollHolder = new Map<string, string>();

  // Long-poll. A newer poll for the same login closes the older one (it gets null → 204).
  // holder: extension tab id (x-ext-tab); '' = anonymous, never gets a re-delivery.
  function next(login: string, signal?: AbortSignal, waitMs = L.pollMs, holderIn = ''): Promise<Wire | null> {
    const holder = HOLDER.test(holderIn) ? holderIn : '';
    const prev = boxes.get(login)?.poller;
    if (prev !== null && prev !== undefined) {
      boxes.get(login)!.poller = null;
      clearTimeout(prev.timer);
      prev.resolve(null); // may tidy() the box away, so take the box only after this
    }
    const b = box(login);
    expire(login, b);
    const ready = leased(b, holder) ?? pick(login, b, holder);
    if (ready !== null || waitMs <= 0) {
      tidy(login);
      return Promise.resolve(ready);
    }
    return new Promise((resolve) => {
      const id = ++pollSeq;
      pollHolder.set(login, holder);
      const finish = (w: Wire | null) => {
        if (b.poller?.id === id)
          b.poller = null;
        signal?.removeEventListener('abort', onAbort);
        resolve(w);
        if (boxes.get(login) === b)
          tidy(login);
      };
      const onAbort = () => {
        if (b.poller?.id === id) {
          clearTimeout(b.poller.timer);
          finish(null);
        }
      };
      const timer = setTimeout(() => finish(null), waitMs);
      timer.unref?.();
      b.poller = { id, resolve: finish, timer };
      if (signal?.aborted)
        onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Report from the extension. Unknown id / other login's id → 'unknown' (no leak which).
  // Repeated report of a finished command → 'ok' without any effect; report of a lost one → 'lost'.
  function report(login: string, body: unknown): { status: 'ok' | 'lost' | 'unknown' | 'bad' | 'too_big'; error?: string } {
    if (body === null || typeof body !== 'object')
      return { status: 'bad', error: 'тело не объект' };
    const { id, ok, result, error } = body as Record<string, unknown>;
    if (str(id, 100) === false || typeof ok !== 'boolean')
      return { status: 'bad', error: 'нужны id и ok' };
    if (ok === false && (typeof error !== 'string' || error.length > 2000))
      return { status: 'bad', error: 'нужен error (до 2000)' };
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(result ?? null)); }
    catch { return { status: 'bad', error: 'result не JSON' }; }
    if (size > L.maxResultBytes)
      return { status: 'too_big', error: `result больше ${L.maxResultBytes} байт` };
    const b = boxes.get(login);
    const p = b?.inflight.get(id as string);
    if (b === undefined || p === undefined) {
      const row = rows.get(key(login, id as string));
      if (row?.status === 'done')
        return { status: 'ok' };

      return row?.status === 'lost' ? { status: 'lost' } : { status: 'unknown' };
    }

    b.inflight.delete(id as string);
    clearTimeout(p.timer);
    mark(login, p.wire, 'done');
    log(`ext-cmd ${login} ${p.wire.kind} ${p.wire.id} ${ok ? 'ok' : 'fail'} ${size}b`);
    p.done(ok ? { ok: true, result: result ?? null } : { ok: false, error: error as string });
    tidy(login);
    return { status: 'ok' };
  }

  const journal = () => [...rows.values()].map(r => ({ ...r }));

  const stats = () => ({ accounts: boxes.size, polls: [...boxes.values()].filter((b) => b.poller !== null).length, queued: [...boxes.values()].reduce((n, b) => n + b.queue.length + b.inflight.size, 0) });

  return { enqueue, next, report, stats, journal };
}

// process-wide singleton used by routes and (stage C) server code
export const bus = createBus({ journal: commandJournal() });
export const enqueue = bus.enqueue;

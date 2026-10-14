// Access tokens + device slots + fingerprint score + 4-hour pass + daily limit.
// Only hashes are stored: sha256(token), sha256(pass), per-signal hashes sent by the extension.
// Pure node module (node:sqlite), path injected, so tests run on a temp file.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const SLOTS = 2;
export const PASS_MS = 4 * 60 * 60 * 1000;
export const DAILY_LIMIT = 500;

// Fingerprint signals and weights (sum = 10). deviceId dominates; timezone/screen/cores/memory are light.
export const WEIGHTS = { deviceId: 4, gpu: 1.5, os: 1, fonts: 1, screen: 0.5, cores: 0.5, memory: 0.5, timezone: 0.5, language: 0.5 } as const;
export type Signal = keyof typeof WEIGHTS;
export type SignalHashes = Partial<Record<Signal, string>>;

export const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

export type Zone = 'match' | 'flagged' | 'new';
export type CheckResult = {
  status: 200 | 401 | 403 | 429;
  reason: string;
  score: number;
  zone: Zone | null;
  slot: number | null;
  pass: string | null;
  passExpires: number | null;
  perSignal: Record<string, boolean>;
  login: string | null;
};

export type AccessEvent = { at: number; token: string; kind: string; detail: string };

export function scoreSignals(ref: SignalHashes, now: SignalHashes): { score: number; perSignal: Record<string, boolean> } {
  let sum = 0;
  const perSignal: Record<string, boolean> = {};
  for (const [name, weight] of Object.entries(WEIGHTS) as Array<[Signal, number]>) {
    const same = Boolean(ref[name]) && ref[name] === now[name];
    perSignal[name] = same;
    if (same)
      sum += weight;
  }

  return { score: Math.round(sum * 10) / 10, perSignal };
}

export function zoneOf(score: number): Zone {
  return score >= 8 ? 'match' : score >= 5 ? 'flagged' : 'new';
}

const HASH = /^[a-f0-9]{16,128}$/;

export function cleanSignals(raw: unknown): SignalHashes {
  const out: SignalHashes = {};
  if (typeof raw !== 'object' || raw === null)
    return out;

  for (const name of Object.keys(WEIGHTS) as Signal[]) {
    const value = (raw as Record<string, unknown>)[name];
    if (typeof value === 'string' && HASH.test(value))
      out[name] = value;
  }

  return out;
}

// ---- Server-side fingerprint: the extension sends raw signals, the server normalizes and hashes them ----
// Raw values are never stored: only HMAC(pepper, name:value). Old clients sent sha256(name:value): still matched.
export const RAW_MAX = 300;

export function gpuChip(renderer: string): string {
  const text = renderer.toLowerCase();
  const vendor = /nvidia|geforce/.test(text) ? 'nvidia' : /amd|radeon/.test(text) ? 'amd' : /intel/.test(text) ? 'intel' : /apple/.test(text) ? 'apple' : /swiftshader|llvmpipe|software/.test(text) ? 'software' : 'other';
  const model = text.match(/\b(rtx|gtx|mx|rx|arc|iris(?: xe)?|uhd|hd|m\d)\s*(?:graphics\s*)?(\d{2,4}[a-z]?)?\b/);
  const apple = text.match(/apple (m\d(?: pro| max| ultra)?)/);

  return [vendor, apple ? apple[1] : model ? [model[1], model[2]].filter(Boolean).join(' ') : ''].filter(Boolean).join(' ').trim();
}

export function normalizeRaw(raw: unknown): Partial<Record<Signal, string>> {
  const out: Partial<Record<Signal, string>> = {};
  if (typeof raw !== 'object' || raw === null)
    return out;

  for (const name of Object.keys(WEIGHTS) as Signal[]) {
    const value = (raw as Record<string, unknown>)[name];
    if (typeof value !== 'string' && typeof value !== 'number')
      continue;

    const text = String(value).trim().slice(0, RAW_MAX);
    out[name] = name === 'gpu' ? gpuChip(text) : name === 'fonts' ? text.split(',').map(font => font.trim()).filter(Boolean).sort().join(',') : text;
  }

  return out;
}

export function pepper(env: Record<string, string | undefined> = process.env): string {
  return env.FP_PEPPER || env.SESSION_SECRET || 'dev-only-fp-pepper';
}

export function hashRaw(raw: unknown, key = pepper()): { signals: SignalHashes; legacy: SignalHashes } {
  const clean = normalizeRaw(raw);
  const signals: SignalHashes = {};
  const legacy: SignalHashes = {};
  for (const [name, value] of Object.entries(clean) as Array<[Signal, string]>) {
    if (!value && name !== 'gpu')
      continue;

    signals[name] = crypto.createHmac('sha256', key).update(`${name}:${value}`).digest('hex');
    legacy[name] = sha256(`${name}:${value}`);
  }

  return { signals, legacy };
}

// Check body → signal hashes: { raw } (thin client) or { signals } (old client, already hashed).
export function signalsOf(body: unknown, key = pepper()): { signals: SignalHashes; legacy: SignalHashes | null } {
  const row = (body ?? {}) as { raw?: unknown; signals?: unknown };
  if (row.raw !== undefined)
    return hashRaw(row.raw, key);

  return { signals: cleanSignals(row.signals), legacy: null };
}

export function openAccess(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_token (hash TEXT PRIMARY KEY, label TEXT, login TEXT, created INTEGER, revoked INTEGER DEFAULT 0, daily_limit INTEGER);
    CREATE TABLE IF NOT EXISTS access_device (token_hash TEXT, slot INTEGER, device_hash TEXT, ref TEXT, first_seen INTEGER, last_seen INTEGER, last_score REAL, last_zone TEXT, PRIMARY KEY (token_hash, slot));
    CREATE TABLE IF NOT EXISTS access_pass (hash TEXT PRIMARY KEY, token_hash TEXT, slot INTEGER, expires INTEGER);
    CREATE TABLE IF NOT EXISTS access_usage (token_hash TEXT, day TEXT, count INTEGER, PRIMARY KEY (token_hash, day));
    CREATE TABLE IF NOT EXISTS access_log (at INTEGER, token TEXT, kind TEXT, detail TEXT);
  `);
  const log = (tokenHash: string, kind: string, detail: string) => db.prepare('INSERT INTO access_log VALUES (?, ?, ?, ?)').run(Date.now(), tokenHash.slice(0, 12), kind, detail);
  const tokenRow = (hash: string) => db.prepare('SELECT * FROM access_token WHERE hash = ?').get(hash) as { hash: string; label: string; login: string; revoked: number; daily_limit: number | null } | undefined;
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);

  function fail(status: CheckResult['status'], reason: string, extra: Partial<CheckResult> = {}): CheckResult {
    return { status, reason, score: 0, zone: null, slot: null, pass: null, passExpires: null, perSignal: {}, login: null, ...extra };
  }

  return {
    db,
    issue(label: string, login: string, dailyLimit = DAILY_LIMIT): string {
      const token = `cct_${crypto.randomBytes(24).toString('base64url')}`;
      db.prepare('INSERT INTO access_token (hash, label, login, created, daily_limit) VALUES (?, ?, ?, ?, ?)').run(sha256(token), label, login, Date.now(), dailyLimit);
      log(sha256(token), 'issue', `label=${label} login=${login}`);

      return token;
    },
    // Registers a known token (only its hash). Never rebinds: returns the login the hash is bound to.
    adopt(token: string, label: string, login: string, dailyLimit = DAILY_LIMIT): string {
      const hash = sha256(token);
      const row = tokenRow(hash);
      if (row)
        return row.login;

      db.prepare('INSERT INTO access_token (hash, label, login, created, daily_limit) VALUES (?, ?, ?, ?, ?)').run(hash, label, login, Date.now(), dailyLimit);
      log(hash, 'adopt', `label=${label} login=${login}`);

      return login;
    },
    revoke(tokenOrHash: string): boolean {
      const hash = HASH.test(tokenOrHash) ? tokenOrHash : sha256(tokenOrHash);
      const done = db.prepare('UPDATE access_token SET revoked = 1 WHERE hash = ? OR hash LIKE ?').run(hash, `${tokenOrHash}%`);
      db.prepare('DELETE FROM access_pass WHERE token_hash = ?').run(hash);
      log(hash, 'revoke', '');

      return Number(done.changes) > 0;
    },
    unbind(tokenHashPrefix: string, slot: number): boolean {
      const row = db.prepare('SELECT hash FROM access_token WHERE hash LIKE ?').get(`${tokenHashPrefix}%`) as { hash: string } | undefined;
      if (!row)
        return false;

      db.prepare('DELETE FROM access_device WHERE token_hash = ? AND slot = ?').run(row.hash, slot);
      db.prepare('DELETE FROM access_pass WHERE token_hash = ? AND slot = ?').run(row.hash, slot);
      log(row.hash, 'unbind', `slot=${slot}`);

      return true;
    },
    loginOf(token: string): string | null {
      const row = tokenRow(sha256(token));

      return row && row.revoked === 0 ? row.login : null;
    },
    // Full check: at browser start and every 4 hours. Returns a pass for the next 4 hours.
    // body: { raw } from the thin client (hashed here) or old-style hashes.
    checkBody(token: string, body: unknown, now = Date.now()): CheckResult {
      const { signals, legacy } = signalsOf(body);

      return this.checkIn(token, signals, now, legacy);
    },
    checkIn(token: string, rawSignals: unknown, now = Date.now(), legacy: SignalHashes | null = null): CheckResult {
      const hash = sha256(token);
      const row = tokenRow(hash);
      if (!row)
        return fail(401, 'неизвестный токен');

      if (row.revoked)
        return fail(401, 'токен отозван');

      const signals = cleanSignals(rawSignals);
      if (!signals.deviceId)
        return fail(403, 'нет deviceId');

      const devices = db.prepare('SELECT * FROM access_device WHERE token_hash = ? ORDER BY slot').all(hash) as Array<{ slot: number; ref: string }>;
      let best: { slot: number; score: number; perSignal: Record<string, boolean> } | null = null;
      for (const device of devices) {
        const ref = JSON.parse(device.ref) as SignalHashes;
        const fresh = scoreSignals(ref, signals);
        const old = legacy ? scoreSignals(ref, legacy) : null;
        const scored = old && old.score > fresh.score ? old : fresh;
        if (best === null || scored.score > best.score)
          best = { slot: device.slot, ...scored };
      }
      const zone = best ? zoneOf(best.score) : 'new';
      let slot: number;
      let reason: string;
      if (best && zone !== 'new') {
        slot = best.slot;
        if (zone === 'match') {
          db.prepare('UPDATE access_device SET ref = ?, last_seen = ?, last_score = ?, last_zone = ? WHERE token_hash = ? AND slot = ?').run(JSON.stringify(signals), now, best.score, zone, hash, slot);
          reason = `совпадение ${best.score}/10, эталон обновлён`;
        }
        else {
          db.prepare('UPDATE access_device SET last_seen = ?, last_score = ?, last_zone = ? WHERE token_hash = ? AND slot = ?').run(now, best.score, zone, hash, slot);
          reason = `вход с изменённого устройства ${best.score}/10 (пометка)`;
        }
      }
      else {
        const used = new Set(devices.map(device => device.slot));
        const free = [...Array(SLOTS).keys()].map(i => i + 1).find(i => !used.has(i));
        if (free === undefined) {
          log(hash, 'deny', `score=${best?.score ?? 0} slots full`);

          return fail(403, `новое устройство (скор ${best?.score ?? 0}/10), а оба слота заняты — отвяжите старое`, { score: best?.score ?? 0, zone: 'new', perSignal: best?.perSignal ?? {} });
        }
        slot = free;
        db.prepare('INSERT INTO access_device VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(hash, slot, signals.deviceId, JSON.stringify(signals), now, now, 10, 'new');
        reason = `новое устройство (скор ${best?.score ?? 0}/10) — занят слот ${slot}`;
      }
      const pass = `ccp_${crypto.randomBytes(24).toString('base64url')}`;
      const passExpires = now + PASS_MS;
      db.prepare('DELETE FROM access_pass WHERE token_hash = ? AND slot = ?').run(hash, slot);
      db.prepare('INSERT INTO access_pass VALUES (?, ?, ?, ?)').run(sha256(pass), hash, slot, passExpires);
      log(hash, 'check', `${reason}; slot=${slot}`);

      return { status: 200, reason, score: best && zone !== 'new' ? best.score : (best?.score ?? 0), zone, slot, pass, passExpires, perSignal: best?.perSignal ?? {}, login: row.login };
    },
    // Cheap per-request check: pass valid + daily limit.
    usePass(pass: string, now = Date.now()): { status: 200 | 401 | 429; reason: string; used: number; limit: number; login?: string } {
      const row = db.prepare('SELECT p.token_hash AS token_hash, p.expires AS expires, t.revoked AS revoked, t.daily_limit AS lim, t.login AS login FROM access_pass p JOIN access_token t ON t.hash = p.token_hash WHERE p.hash = ?').get(sha256(pass)) as { token_hash: string; expires: number; revoked: number; lim: number | null; login: string } | undefined;
      if (!row || row.revoked)
        return { status: 401, reason: 'нет пропуска', used: 0, limit: 0 };

      if (row.expires <= now)
        return { status: 401, reason: 'пропуск истёк, нужна новая проверка', used: 0, limit: 0 };

      const limit = row.lim ?? DAILY_LIMIT;
      const today = day(now);
      const used = (db.prepare('SELECT count FROM access_usage WHERE token_hash = ? AND day = ?').get(row.token_hash, today) as { count: number } | undefined)?.count ?? 0;
      if (used >= limit) {
        log(row.token_hash, 'limit', `${used}/${limit}`);

        return { status: 429, reason: 'дневной лимит исчерпан', used, limit };
      }
      db.prepare('INSERT INTO access_usage VALUES (?, ?, 1) ON CONFLICT (token_hash, day) DO UPDATE SET count = count + 1').run(row.token_hash, today);

      return { status: 200, reason: 'ok', used: used + 1, limit, login: row.login };
    },
    // Gate for every extension endpoint (Bearer extToken → login). Logins without access tokens keep the
    // legacy extToken flow (soft transition for the owner); logins with tokens need a valid 4-hour pass.
    gate(login: string, pass: string, now = Date.now()): { ok: boolean; status: 200 | 403 | 429; reason: string; mode: 'legacy' | 'pass' } {
      const rows = db.prepare('SELECT revoked FROM access_token WHERE login = ?').all(login) as Array<{ revoked: number }>;
      if (rows.length === 0)
        return { ok: true, status: 200, reason: 'legacy extToken', mode: 'legacy' };

      if (rows.every(row => row.revoked === 1))
        return { ok: false, status: 403, reason: 'токен доступа отозван', mode: 'pass' };

      if (!pass)
        return { ok: false, status: 403, reason: 'нужен пропуск: проверьте устройство в расширении', mode: 'pass' };

      const used = this.usePass(pass, now);
      if (used.status === 429)
        return { ok: false, status: 429, reason: used.reason, mode: 'pass' };

      if (used.status !== 200 || used.login !== login)
        return { ok: false, status: 403, reason: used.status === 200 ? 'пропуск другого аккаунта' : used.reason, mode: 'pass' };

      return { ok: true, status: 200, reason: 'ok', mode: 'pass' };
    },
    list() {
      const tokens = db.prepare('SELECT hash, label, login, created, revoked, daily_limit FROM access_token ORDER BY created').all() as Array<{ hash: string; label: string; login: string; created: number; revoked: number; daily_limit: number }>;

      return tokens.map(token => ({
        id: token.hash.slice(0, 12),
        label: token.label,
        login: token.login,
        revoked: token.revoked === 1,
        limit: token.daily_limit,
        usedToday: (db.prepare('SELECT count FROM access_usage WHERE token_hash = ? AND day = ?').get(token.hash, day(Date.now())) as { count: number } | undefined)?.count ?? 0,
        devices: (db.prepare('SELECT slot, device_hash, first_seen, last_seen, last_score, last_zone, ref FROM access_device WHERE token_hash = ? ORDER BY slot').all(token.hash) as Array<Record<string, unknown>>).map(d => ({ ...d, device_hash: String(d.device_hash).slice(0, 12), ref: JSON.parse(String(d.ref)) as SignalHashes })),
        passes: (db.prepare('SELECT slot, expires FROM access_pass WHERE token_hash = ?').all(token.hash) as Array<{ slot: number; expires: number }>),
      }));
    },
    events(limit = 100): AccessEvent[] {
      return db.prepare('SELECT at, token, kind, detail FROM access_log ORDER BY at DESC LIMIT ?').all(limit) as AccessEvent[];
    },
  };
}

export type AccessStore = ReturnType<typeof openAccess>;

let shared: AccessStore | null = null;

// Same dir rule as the account files: WEB_SECRETS dir → /data on Railway (the volume) → ./data.
export function accessFile(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  if (env.ACCESS_DB)
    return env.ACCESS_DB;

  const dir = env.WEB_SECRETS ? path.dirname(env.WEB_SECRETS) : env.RAILWAY_ENVIRONMENT ? '/data' : path.join(cwd, 'data');

  return path.join(dir, 'access.sqlite');
}

export function accessStore(file = accessFile()): AccessStore {
  if (!shared) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    shared = openAccess(file);
  }

  return shared;
}

// Logs never carry request bodies or key headers: only path, status and a short token id.
export function safeLogLine(method: string, path: string, status: number, tokenId = ''): string {
  return `[access] ${method} ${path.split('?')[0]} ${status}${tokenId ? ` t=${tokenId.slice(0, 8)}` : ''}`;
}

// DEMO_TOKEN_LOGIN gate: explicit flag (no RAILWAY_ENVIRONMENT check any more), demo login only, never the owner.
export const DEMO_LOGINS = new Set(['vasya-pupkin']);

export function demoLoginAllowed(env: Record<string, string | undefined>, login: string | null): boolean {
  return env.DEMO_TOKEN_LOGIN === '1' && login !== null && DEMO_LOGINS.has(login);
}

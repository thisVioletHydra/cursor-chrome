// DEMO_TOKEN_LOGIN: token login for the single demo account «Вася Пупкин» (vasya-pupkin).
// - on only with DEMO_TOKEN_LOGIN=1 and DEMO_LOGIN_TOKEN set (works on Railway too: Roman allowed it on prod);
// - the token is NOT shown anywhere (only an input on the login page); env holds it, the access DB only its sha256;
// - the login is hard-bound: whatever the DB says, this path never yields any other login (Roman or anyone);
// - demo limits: requests per minute + per day; our LLM key is never spent (BYOK only).
import crypto from 'node:crypto';
import process from 'node:process';

import type { AccessStore } from './access';

export const DEMO_LOGIN = 'vasya-pupkin';
export const DEMO_NAME = 'Вася Пупкин';
export const DEMO_PER_MINUTE = 30;
export const DEMO_PER_DAY = 300;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

type Env = Record<string, string | undefined>;

export function demoToken(env: Env = process.env): string {
  const token = (env.DEMO_LOGIN_TOKEN ?? '').trim();

  return env.DEMO_TOKEN_LOGIN === '1' && TOKEN_RE.test(token) ? token : '';
}

export function isDemoLogin(login: string | null | undefined): boolean {
  return login === DEMO_LOGIN;
}

export const DEMO_BAR_TEXT = 'Демо-аккаунт: временный, данные могут быть удалены';

// The single server-side check for the demo session (admin layout → red bottom bar). Guest preview is never demo.
export function isDemoSession(login: string | null | undefined, preview = false): boolean {
  return preview === false && isDemoLogin(login);
}

// Seeds the hash of DEMO_LOGIN_TOKEN into the access DB (once). Refuses if that hash belongs to another login.
export function ensureDemoToken(store: AccessStore, env: Env = process.env): boolean {
  const token = demoToken(env);
  if (!token)
    return false;

  return store.adopt(token, 'demo', DEMO_LOGIN, DEMO_PER_DAY) === DEMO_LOGIN;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The only way in: flag on, the exact env token, its hash in the DB bound to vasya-pupkin. Returns that login or null.
export function demoLoginFor(store: AccessStore, input: string, env: Env = process.env): string | null {
  const token = demoToken(env);
  const given = (input ?? '').trim();
  if (!token || !given || same(given, token) === false)
    return null;

  ensureDemoToken(store, env);

  return store.loginOf(given) === DEMO_LOGIN ? DEMO_LOGIN : null;
}

// Demo request limits (in memory, per process): a sliding minute + a calendar day (UTC).
const hits: number[] = [];
let day = '';
let dayCount = 0;

export function demoAllow(now = Date.now(), perMinute = DEMO_PER_MINUTE, perDay = DEMO_PER_DAY): { ok: boolean; reason: string } {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  while (hits.length > 0 && now - hits[0] >= 60_000)
    hits.shift();
  if (dayCount >= perDay)
    return { ok: false, reason: `демо: лимит ${perDay} запросов в день` };
  if (hits.length >= perMinute)
    return { ok: false, reason: `демо: не больше ${perMinute} запросов в минуту` };

  hits.push(now);
  dayCount += 1;

  return { ok: true, reason: '' };
}

export function resetDemoLimits(): void {
  hits.length = 0;
  day = '';
  dayCount = 0;
}

// Our server chain is never used for the demo account: BYOK (its own keys) only.
export function serverChainFor<T>(login: string, chain: T[]): T[] {
  return isDemoLogin(login) ? [] : chain;
}

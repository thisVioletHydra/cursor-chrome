import crypto from 'node:crypto';
import process from 'node:process';

export type Session = { login: string; exp: number };

const DAY = 86_400_000;

function secret(): string {
  return process.env.SESSION_SECRET || 'dev-only-change-me';
}

export function signSession(login: string): string {
  const payload = Buffer.from(JSON.stringify({ login, exp: Date.now() + 7 * DAY })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readSession(raw: string | undefined): Session | null {
  if (raw === null || raw === undefined)
    return null;

  const [payload, sig] = raw.split('.');
  if (!payload || !sig)
    return null;

  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || crypto.timingSafeEqual(a, b) === false)
    return null;

  const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
  if (session.exp < Date.now())
    return null;

  return session;
}

export function allowedLogins(): string[] {
  const raw = process.env.ADMIN_GITHUB_LOGINS || 'thisVioletHydra';
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

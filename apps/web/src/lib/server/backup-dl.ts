// POST /admin/backup: zip with ONLY the current account's server data (account file + its sqlite copy).
// Secrets are masked and listed in manifest.json. LLM keys (modelChain) never leave the server.
// Same-origin only, no-store. Read-only: the live DB is copied with VACUUM INTO, nothing is written to /data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite from 'node:sqlite';
import { zipDir } from './thin/dl.ts';

export const SECRET_FIELDS = ['telegramToken', 'modelChain', 'hhAccessToken', 'hhClientId', 'hhClientSecret', 'extToken'] as const;
const SECRETISH = /token|secret|key|chain|password|cookie/i;

export type BackupDeps = {
  readSession: (raw: string | undefined) => { login: string } | null;
  allowed: (login: string) => boolean;
  isCreator: (login: string) => boolean;
  accountText: (login: string) => Promise<string | null>;
  dbFile: (login: string) => string;
  version?: string;
  now?: () => number;
};

const NO_STORE = { 'cache-control': 'no-store', 'pragma': 'no-cache' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, 'content-type': 'application/json; charset=utf-8' } });

function maskValue(value: unknown, at: string, masked: string[]): unknown {
  if (Array.isArray(value))
    return value.map((item, index) => maskValue(item, `${at}[${index}]`, masked));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const here = at.length > 0 ? `${at}.${key}` : key;
      if ((at.length === 0 && (SECRET_FIELDS as readonly string[]).includes(key)) || SECRETISH.test(key)) {
        masked.push(here);
        out[key] = typeof inner === 'string' && inner.length === 0 ? '' : inner === null || inner === undefined ? inner : '***';
        continue;
      }
      out[key] = maskValue(inner, here, masked);
    }
    return out;
  }
  // JSON stored as a string (e.g. legacy fields): parse, mask inside, keep as string.
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      const before = masked.length;
      const inner = maskValue(JSON.parse(value), at, masked);
      return masked.length > before ? JSON.stringify(inner) : value;
    }
    catch {
      return value;
    }
  }
  return value;
}

export function maskAccount(raw: unknown): { account: Record<string, unknown>; masked: string[] } {
  const source = typeof raw === 'object' && raw !== null && Array.isArray(raw) === false ? raw : {};
  const masked: string[] = [];
  const account = maskValue(source, '', masked) as Record<string, unknown>;

  return { account, masked: masked.sort() };
}

// Consistent copy without locking writers (WAL): VACUUM INTO from a separate read-only connection.
export function snapshotDb(src: string, dst: string): boolean {
  if (fs.existsSync(src) === false)
    return false;

  const db = new sqlite.DatabaseSync(src, { readOnly: true, timeout: 5_000 });
  try {
    db.prepare('VACUUM INTO ?').run(dst);
  }
  finally {
    db.close();
  }

  return true;
}

export async function backupResponse(request: Request, cookie: (name: string) => string | undefined, deps: BackupDeps): Promise<Response> {
  if (request.method !== 'POST')
    return reply(405, { error: 'method' });
  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(request.url).origin)
    return reply(403, { error: 'origin' });
  const session = deps.readSession(cookie('session'));
  if (session === null || deps.allowed(session.login) === false)
    return reply(401, { error: 'нет' });
  if (deps.isCreator(session.login) && cookie('preview') === 'guest')
    return reply(403, { error: 'preview' });

  const login = session.login;
  const at = (deps.now ?? Date.now)();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nj-backup-'));
  try {
    const text = await deps.accountText(login);
    let masked: string[] = [];
    let accountState: 'ok' | 'missing' | 'unreadable' = 'missing';
    if (text !== null) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
        accountState = 'ok';
      }
      catch {
        accountState = 'unreadable';
      }
      if (accountState === 'ok') {
        const out = maskAccount(parsed);
        masked = out.masked;
        fs.writeFileSync(path.join(dir, 'account.json'), `${JSON.stringify(out.account, null, 2)}\n`);
      }
    }
    const hasDb = snapshotDb(deps.dbFile(login), path.join(dir, 'hh.sqlite'));
    const manifest = {
      kind: 'nojobnoproblem-server-backup',
      format: 1,
      login,
      createdAt: new Date(at).toISOString(),
      version: deps.version ?? '',
      files: [...(accountState === 'ok' ? ['account.json'] : []), ...(hasDb ? ['hh.sqlite'] : [])],
      account: accountState,
      database: hasDb ? 'ok' : 'missing',
      maskedSecrets: masked,
      note: 'Секреты заменены на «***» (или пусто, если не заданы). Ключи нейросетей в бэкап не входят. Данные расширения сохраняй через «Экспорт JSON» в расширении.',
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const zip = zipDir(dir);
    const stamp = new Date(at).toISOString().slice(0, 19).replace(/[:T]/g, '-');

    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: { ...NO_STORE, 'content-type': 'application/zip', 'content-disposition': `attachment; filename="nojobnoproblem-${login}-${stamp}.zip"` },
    });
  }
  catch {
    return reply(500, { error: 'бэкап не собрался' });
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// /dl/<token>: HMAC-signed download link for the current extension zip. 24 h, bound to the user's extToken
// (a reissued extToken kills old links). Token = base64url({l,e}).hmac(secret, l.e.sha256(extToken)).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const DL_MS = 24 * 60 * 60 * 1000;

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const mac = (secret: string, login: string, exp: number, extToken: string) => crypto.createHmac('sha256', secret).update(`${login}.${exp}.${sha(extToken)}`).digest('base64url');

export function dlSecret(env: Record<string, string | undefined>): string {
  return env.DL_SECRET || env.SESSION_SECRET || 'dev-only-dl-secret';
}

export function signDl(login: string, extToken: string, secret: string, now = Date.now()): string {
  const exp = now + DL_MS;
  const head = Buffer.from(JSON.stringify({ l: login, e: exp })).toString('base64url');

  return `${head}.${mac(secret, login, exp, extToken)}`;
}

export async function verifyDl(token: string, secret: string, extTokenOf: (login: string) => Promise<string>, now = Date.now()): Promise<{ ok: true; login: string } | { ok: false; reason: string }> {
  const [head, sig] = token.split('.');
  if (!head || !sig)
    return { ok: false, reason: 'битая ссылка' };

  let body: { l?: unknown; e?: unknown };
  try {
    body = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { l?: unknown; e?: unknown };
  }
  catch {
    return { ok: false, reason: 'битая ссылка' };
  }
  if (typeof body.l !== 'string' || typeof body.e !== 'number')
    return { ok: false, reason: 'битая ссылка' };
  if (body.e <= now)
    return { ok: false, reason: 'ссылка истекла' };

  const extToken = await extTokenOf(body.l);
  if (!extToken)
    return { ok: false, reason: 'нет токена' };

  const want = Buffer.from(mac(secret, body.l, body.e, extToken));
  const got = Buffer.from(sig);
  if (want.length !== got.length || crypto.timingSafeEqual(want, got) === false)
    return { ok: false, reason: 'подпись не совпала' };

  return { ok: true, login: body.l };
}

export function distDir(env: Record<string, string | undefined>, cwd: string): string {
  if (env.EXT_DIST)
    return env.EXT_DIST;

  const near = path.resolve(cwd, '../extension/dist');

  return fs.existsSync(near) ? near : path.resolve(cwd, 'apps/extension/dist');
}

function files(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name), base) : [path.relative(base, path.join(dir, entry.name))]).sort();
}

// Minimal zip writer (deflate), no dependencies.
export function zipDir(dir: string): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const rel of files(dir)) {
    const name = Buffer.from(rel.split(path.sep).join('/'));
    const data = fs.readFileSync(path.join(dir, rel));
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}

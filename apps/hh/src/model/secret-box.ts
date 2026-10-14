// Lazy AES-256-GCM for secret fields in account json. Format: enc:v1:<iv b64>:<ct+tag b64>.
// Reading accepts old plain text. Without SECRETS_KEY values stay plain (with one warning).
// Wrong key -> throws SecretKeyError (never returns empty, so data is not overwritten).
import crypto from 'node:crypto';
import process from 'node:process';

const PREFIX = 'enc:v1:';
export const SECRET_FIELDS = ['telegramToken', 'modelChain', 'hhAccessToken', 'hhClientSecret'] as const;

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretKeyError';
  }
}

let warned = false;

function keyFrom(env: string | undefined): Buffer | null {
  if (env === undefined || env.trim() === '')
    return null;
  const key = Buffer.from(env.trim(), 'base64');
  if (key.length !== 32)
    throw new SecretKeyError('SECRETS_KEY: нужно 32 байта в base64');
  return key;
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptValue(plain: string, env = process.env.SECRETS_KEY): string {
  if (plain === '' || isEncrypted(plain))
    return plain;
  const key = keyFrom(env);
  if (key === null) {
    if (!warned) {
      warned = true;
      console.warn('SECRETS_KEY не задан: секреты аккаунтов хранятся открыто');
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${iv.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptValue(value: string, env = process.env.SECRETS_KEY): string {
  if (!isEncrypted(value))
    return value;
  const key = keyFrom(env);
  if (key === null)
    throw new SecretKeyError('секрет зашифрован, а SECRETS_KEY не задан');
  const [ivB64, ctB64] = value.slice(PREFIX.length).split(':');
  const iv = Buffer.from(ivB64 ?? '', 'base64');
  const data = Buffer.from(ctB64 ?? '', 'base64');
  if (iv.length !== 12 || data.length < 16)
    throw new SecretKeyError('секрет повреждён');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  }
  catch {
    throw new SecretKeyError('неверный SECRETS_KEY: секрет не расшифровать');
  }
}

export function decryptFields<T extends Record<string, unknown>>(obj: T, env = process.env.SECRETS_KEY): T {
  const out: Record<string, unknown> = { ...obj };
  for (const f of SECRET_FIELDS) {
    if (typeof out[f] === 'string')
      out[f] = decryptValue(out[f] as string, env);
  }
  return out as T;
}

export function encryptFields<T extends Record<string, unknown>>(obj: T, env = process.env.SECRETS_KEY): T {
  const out: Record<string, unknown> = { ...obj };
  for (const f of SECRET_FIELDS) {
    if (typeof out[f] === 'string')
      out[f] = encryptValue(out[f] as string, env);
  }
  return out as T;
}

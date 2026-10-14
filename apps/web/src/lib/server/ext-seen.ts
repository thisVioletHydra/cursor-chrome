// Last successful extension request (valid Bearer extToken) per login, for the «До старта» lamp.
// Kept in its own small file <root>/ext-seen/<login>.json (not in accounts/*.json) so it never races
// with account writes; missing file = «never». Writes are throttled to one per minute per login.
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { writeJsonAtomic } from '@cursor-chrome/hh';

export const EXT_STALE_MS = 15 * 60_000;
const WRITE_EVERY_MS = 60_000;
const lastWrite = new Map<string, number>();

export type ExtSeenLamp = 'never' | 'stale' | 'ok';

function seenPath(login: string): string | null {
  if (/^[A-Za-z0-9-]{1,39}$/.test(login) === false)
    return null;
  const root = process.env.WEB_SECRETS ? path.dirname(process.env.WEB_SECRETS) : process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(process.cwd(), 'data');

  return path.join(root, 'ext-seen', `${login}.json`);
}

export function extSeenLamp(at: number, now = Date.now()): ExtSeenLamp {
  if (!at || at <= 0)
    return 'never';

  return now - at > EXT_STALE_MS ? 'stale' : 'ok';
}

export async function markExtSeen(login: string, now = Date.now()): Promise<void> {
  const file = seenPath(login);
  if (file === null || (lastWrite.has(login) && now - (lastWrite.get(login) ?? 0) < WRITE_EVERY_MS))
    return;
  lastWrite.set(login, now);
  try {
    await fsPromises.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomic(file, { at: now });
  }
  catch {
  }
}

export async function readExtSeen(login: string): Promise<number> {
  const file = seenPath(login);
  if (file === null)
    return 0;
  try {
    const at = JSON.parse(await fsPromises.readFile(file, 'utf8'))?.at;

    return typeof at === 'number' ? at : 0;
  }
  catch {
    return 0;
  }
}

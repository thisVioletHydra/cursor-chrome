import type { RequestEvent } from '@sveltejs/kit';

import crypto from 'node:crypto';
import { CREATOR, readAccount } from './secrets';

export async function extLogin(request: RequestEvent['request']): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (given.length === 0)
    return null;

  const account = await readAccount(CREATOR);
  const saved = account.extToken;
  if (saved.length === 0 || saved.length !== given.length)
    return null;

  const same = crypto.timingSafeEqual(Buffer.from(saved), Buffer.from(given));

  return same ? CREATOR : null;
}

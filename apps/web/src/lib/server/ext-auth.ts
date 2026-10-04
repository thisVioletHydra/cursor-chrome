import type { RequestEvent } from '@sveltejs/kit';

import { loginForToken } from './secrets';

export async function extLogin(request: RequestEvent['request']): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (given.length === 0)
    return null;

  return loginForToken(given);
}

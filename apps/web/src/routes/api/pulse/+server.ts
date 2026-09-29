import type { RequestHandler } from './$types';

import { watchPulse } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { line?: unknown } | null;
  const line = typeof body?.line === 'string' ? body.line : '';
  if (line.trim().length === 0)
    return json({ error: 'пусто' }, { status: 400 });

  watchPulse(line);

  return json({ ok: true });
};

import type { RequestHandler } from './$types';

import { watchRestart, watchStop } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { on?: unknown } | null;
  if (body?.on !== true && body?.on !== false)
    return json({ error: 'нет' }, { status: 400 });

  try {
    if (body.on)
      await watchRestart();
    else
      await watchStop();
  }
  catch (error) {
    const text = error instanceof Error ? error.message.trim() : '';

    return json({ error: text.length > 0 ? text.slice(0, 160) : 'не вышло' }, { status: 500 });
  }

  return json({ ok: true, auto: body.on });
};

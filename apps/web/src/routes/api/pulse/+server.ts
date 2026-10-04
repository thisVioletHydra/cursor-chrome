import type { RequestHandler } from './$types';

import { readState, takePilotStart, watchPulse } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';
import { noteWeekPulse } from '$lib/server/week';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { line?: unknown; device?: unknown } | null;
  const line = typeof body?.line === 'string' ? body.line : '';
  const device = typeof body?.device === 'string' ? body.device : '';
  if (line.trim().length === 0)
    return json({ error: 'пусто' }, { status: 400 });

  const stop = await watchPulse(line);
  const [state, saved] = await Promise.all([
    readState().catch(() => null),
    readAccount(login),
  ]);
  const account = await noteWeekPulse(login, saved, device);

  return json({
    ok: true,
    stop,
    start: takePilotStart(),
    auto: state !== null && state.auto === true,
    hours: account.hhHours !== '0',
  });
};

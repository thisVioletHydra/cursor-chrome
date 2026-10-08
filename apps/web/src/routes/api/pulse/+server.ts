import type { RequestHandler } from './$types';

import { readState, takePilotStart, watchPulse } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { extensionBuild } from '$lib/server/extension-build';
import { readAccount } from '$lib/server/secrets';
import { noteWeekPulse } from '$lib/server/week';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { line?: unknown; device?: unknown; version?: unknown; mode?: unknown } | null;
  const line = typeof body?.line === 'string' ? body.line : '';
  const device = typeof body?.device === 'string' ? body.device : '';
  const version = typeof body?.version === 'string' && /^\d+\.\d+\.\d+$/.test(body.version) ? body.version : '';
  const mode = body?.mode === 'full' || body?.mode === 'light' || body?.mode === 'target' ? body.mode : '';
  if (line.trim().length === 0)
    return json({ error: 'пусто' }, { status: 400 });

  const stop = await watchPulse(line, version, mode);
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
    build: await extensionBuild(),
  });
};

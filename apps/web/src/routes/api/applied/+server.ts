import type { RequestHandler } from './$types';

import { markDone, readMemory, remember, writeMemory } from '@cursor-chrome/hh';
import { notifyOwner } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { takeVacancy } from '$lib/server/secrets';

type Body = {
  vacancyId?: string;
  status?: string;
  company?: string;
  title?: string;
  url?: string;
  hints?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as Body | null;
  const id = String(body?.vacancyId ?? '').trim();
  const status = body?.status === 'needsHuman' ? 'needsHuman' : body?.status === 'sent' ? 'sent' : null;
  if (id.length === 0 || status === null)
    return json({ error: 'vacancyId и status' }, { status: 400 });

  const hints = Array.isArray(body?.hints) ? body.hints.filter((item): item is string => typeof item === 'string') : [];
  const done = await markDone(id, status, hints);
  const company = done?.company || String(body?.company ?? '').trim() || 'без компании';
  const url = done?.url || String(body?.url ?? '').trim() || `https://hh.ru/vacancy/${id}`;

  const memory = await readMemory();
  await writeMemory(remember(memory, id, false));

  if (status === 'sent') {
    await takeVacancy(login, { company, url });
    await notifyOwner(`${company}. Откликнулся. ${url}`);
  }
  else {
    const tail = hints.length > 0 ? ` ${hints.join('; ')}` : '';
    await notifyOwner(`${company}. Застрял, зову человека.${tail} ${url}`);
  }

  return json({ ok: true, queued: done !== null });
};

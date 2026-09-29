import type { RequestHandler } from './$types';

import { countSent, markDone, markFailed, readMemory, readQueue, remember, writeMemory } from '@cursor-chrome/hh';
import { notifyDigest, notifyOwner } from '@cursor-chrome/telegram';
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
  reason?: string;
};

const notedSent = new Set<string>();

function claimSent(id: string, prior: string | undefined): boolean {
  if (prior === 'sent' || notedSent.has(id))
    return false;

  notedSent.add(id);

  return true;
}

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as Body | null;
  const id = String(body?.vacancyId ?? '').trim();
  const status = body?.status;
  if (id.length === 0 || (status !== 'sent' && status !== 'needsHuman' && status !== 'failed' && status !== 'stop'))
    return json({ error: 'vacancyId и status' }, { status: 400 });

  const reason = String(body?.reason ?? '').trim().slice(0, 200);

  if (status === 'stop') {
    await notifyOwner(reason.length > 0 ? `Стоп до утра: ${reason}` : 'Стоп до утра');

    return json({ ok: true, queued: false });
  }

  if (status === 'failed') {
    const prior = (await readQueue()).find(row => row.id === id);
    const failed = await markFailed(id, reason);
    const company = failed?.company || String(body?.company ?? '').trim() || 'без компании';
    const url = failed?.url || String(body?.url ?? '').trim() || `https://hh.ru/vacancy/${id}`;
    if (prior?.status === 'pending' && failed !== null && failed.status === 'dropped') {
      const why = failed.lastError || reason;
      const tail = why.length > 0 ? `${why} ` : '';
      await notifyOwner(`${company}. Снял после 3 попыток. ${tail}${url}`);
    }
    else
      notifyDigest('miss', `• ${company} — мимо${reason.length > 0 ? `, ${reason}` : ''}\n  ${url}`);

    return json({ ok: true, queued: failed !== null });
  }

  const prior = (await readQueue()).find(row => row.id === id);
  const hints = Array.isArray(body?.hints) ? body.hints.filter((item): item is string => typeof item === 'string') : [];
  const done = await markDone(id, status, hints);
  const company = done?.company || String(body?.company ?? '').trim() || 'без компании';
  const url = done?.url || String(body?.url ?? '').trim() || `https://hh.ru/vacancy/${id}`;
  const freshSent = status === 'sent' && claimSent(id, prior?.status);
  const memory = await readMemory();
  await writeMemory(freshSent ? countSent(remember(memory, id)) : remember(memory, id));

  if (freshSent) {
    await takeVacancy(login, { company, url });
    const title = done?.title || String(body?.title ?? '').trim();
    const head = title.length > 0 ? `${company} — ${title}` : company;
    await notifyOwner(`Отклик. ${head}\n${url}`);
  }
  else if (status !== 'sent') {
    const tail = hints.length > 0 ? ` ${hints.join('; ')}` : '';
    await notifyOwner(`${company}. Застрял, зову человека.${tail} ${url}`);
  }

  return json({ ok: true, queued: done !== null });
};

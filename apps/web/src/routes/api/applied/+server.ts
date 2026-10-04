import type { RequestHandler } from './$types';

import { markDone, markFailed, markSent, notePassed, readQueue, remember, watchCaptcha } from '@cursor-chrome/hh';
import { notifyVacancy } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount, takeVacancy } from '$lib/server/secrets';
import { noteWeekClick } from '$lib/server/week';

type Body = {
  vacancyId?: string;
  status?: string;
  company?: string;
  title?: string;
  url?: string;
  hints?: unknown;
  reason?: string;
  captcha?: boolean;
  again?: boolean;
};

const noted = new Set<string>();

function claimRow(id: string, status: 'sent' | 'needsHuman', prior: string | undefined): boolean {
  const key = `${status}:${id}`;
  if (prior === status || noted.has(key))
    return false;

  noted.add(key);

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
    if (body?.captcha === true) {
      await watchCaptcha(body.again === true);

      return json({ ok: true, queued: false });
    }

    return json({ ok: true, queued: false });
  }

  if (status === 'failed') {
    const failed = await markFailed(id, reason);
    await noteEmployer(id, reason, failed?.company, failed?.title, body);

    return json({ ok: true, queued: failed !== null });
  }

  const prior = (await readQueue()).find(row => row.id === id);
  const hints = Array.isArray(body?.hints) ? body.hints.filter((item): item is string => typeof item === 'string') : [];
  const done = await markDone(id, status, hints);
  if (status === 'needsHuman')
    await noteEmployer(id, reason, done?.company, done?.title, body);

  const company = done?.company || String(body?.company ?? '').trim() || 'без компании';
  const url = done?.url || String(body?.url ?? '').trim() || `https://hh.ru/vacancy/${id}`;
  const fresh = claimRow(id, status, prior?.status);
  if (status === 'sent' && fresh)
    await markSent(id);
  else
    await remember([id]);

  if (status === 'sent' && fresh) {
    await takeVacancy(login, { company, url });
    await noteWeekClick(login, await readAccount(login));
  }

  if (fresh) {
    notifyVacancy({
      company,
      title: done?.title || String(body?.title ?? '').trim(),
      status,
      at: done?.doneAt ?? Date.now(),
      url,
    });
  }

  return json({ ok: true, queued: done !== null });
};

function noteEmployer(id: string, reason: string, company: string | undefined, title: string | undefined, body: Body | null): Promise<void> {
  if (id === '0' || reason.includes('вопросы работодателя') === false)
    return Promise.resolve();

  return notePassed([{
    id,
    reason: 'вопросы работодателя',
    company: company || String(body?.company ?? ''),
    title: title || String(body?.title ?? ''),
  }]);
}

import type { Vacancy } from '@cursor-chrome/hh';
import type { RequestHandler } from './$types';

import { dayOpen, LOOK_PER_START, pendingCount, QUEUE_TARGET, readMemory, readState, scan, workHours } from '@cursor-chrome/hh';
import { chargeQueued, notifyOwner } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

type Incoming = {
  id?: unknown;
  title?: unknown;
  company?: unknown;
  url?: unknown;
  text?: unknown;
  salaryFrom?: unknown;
  salaryTo?: unknown;
  currency?: unknown;
  remote?: unknown;
  experience?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [account, state, memory] = await Promise.all([readAccount(login), readState(), readMemory()]);
  const queued = await pendingCount();
  const open = account.hhLive === '1' && state.auto && workHours() && dayOpen(memory) && queued < QUEUE_TARGET;
  if (open === false)
    return json({ ok: true, added: 0 });

  const body = await request.json().catch(() => null) as { vacancies?: unknown } | null;
  const list = vacanciesOf(body?.vacancies);
  if (list.length === 0)
    return json({ ok: true, added: 0 });

  const query = account.hhQuery || '';
  const result = await scan({
    query,
    dry: false,
    live: true,
    load: async () => list,
  });

  let added = 0;
  for (const report of result.reports) {
    if (report.verdict === 'apply') {
      added += 1;
      const paid = await chargeQueued({ id: report.id, company: report.company, url: report.url });
      if (paid === false) {
        await notifyOwner('Баланс кончился. Вакансия стоит 1 ₽.');
        break;
      }
    }

    if (report.verdict === 'human')
      await notifyOwner(report.line);
  }

  return json({ ok: true, added, already: result.already });
};

function vacanciesOf(value: unknown): Vacancy[] {
  if (Array.isArray(value) === false)
    return [];

  const out: Vacancy[] = [];
  for (const item of value) {
    const vacancy = vacancyOf(item);
    if (vacancy !== null)
      out.push(vacancy);

    if (out.length >= LOOK_PER_START)
      break;
  }

  return out;
}

function vacancyOf(value: unknown): Vacancy | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Incoming;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (/^\d+$/.test(id) === false || title.length === 0)
    return null;

  const url = typeof row.url === 'string' && row.url.includes('/vacancy/')
    ? row.url.split('?')[0]
    : `https://hh.ru/vacancy/${id}`;

  return {
    id,
    title: title.slice(0, 200),
    company: textOf(row.company, 'без компании').slice(0, 200),
    url,
    text: textOf(row.text, title).slice(0, 8000),
    formUrl: '',
    formBlocked: false,
    salaryFrom: moneyOf(row.salaryFrom),
    salaryTo: moneyOf(row.salaryTo),
    currency: textOf(row.currency, '').slice(0, 8),
    remote: row.remote === true,
    employerId: '',
    experience: textOf(row.experience, '').slice(0, 80),
  };
}

function textOf(value: unknown, fallback: string): string {
  if (typeof value !== 'string')
    return fallback;

  const text = value.trim();

  return text.length > 0 ? text : fallback;
}

function moneyOf(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isFinite(value) === false || value <= 0)
    return null;

  return Math.round(value);
}

import type { Vacancy } from '@cursor-chrome/hh';
import type { RequestHandler } from './$types';

import { dayOpen, fitsTitle, LOOK_PER_START, modelsDown, pendingCount, QUEUE_TARGET, readMemory, readState, scan, splitQueries, watchDeath, watchNote, workHours } from '@cursor-chrome/hh';
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
  query?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [account, state, memory] = await Promise.all([readAccount(login), readState(), readMemory()]);
  const queued = await pendingCount();
  const hoursOk = account.hhHours === '0' || workHours();
  const closed = closedReason(account.hhLive === '1', state.auto, hoursOk, dayOpen(memory), queued < QUEUE_TARGET);
  if (closed.length > 0)
    return json({ ok: true, added: 0, reason: closed });

  const body = await request.json().catch(() => null) as { vacancies?: unknown } | null;
  if (body === null || Array.isArray(body.vacancies) === false || body.vacancies.length === 0)
    return json({ ok: true, added: 0, reason: 'пустое тело' });

  const parsed = vacanciesOf(body.vacancies);
  if (parsed.length === 0)
    return json({ ok: true, added: 0, reason: 'не те id' });

  const query = account.hhQuery || '';
  const queries = splitQueries(query);
  const list = queries.length === 0 ? parsed : parsed.filter(vacancy => fitsTitle(vacancy.title, queries));
  if (list.length === 0)
    return json({ ok: true, added: 0, reason: 'нет вакансий по запросу' });
  let result: Awaited<ReturnType<typeof scan>>;
  try {
    result = await scan({
      query,
      dry: false,
      live: true,
      load: async () => list,
    });
  }
  catch (error) {
    const text = error instanceof Error ? error.message.trim() : '';
    const reason = text.length > 0 ? text.slice(0, 200) : 'скан упал';
    watchDeath('model', reason);

    return json({ ok: false, added: 0, reason });
  }

  let added = 0;
  try {
    for (const report of result.reports) {
      if (report.verdict === 'skip')
        watchNote('model', `${report.company}: ${report.reason}`);

      if (report.verdict === 'apply') {
        added += 1;
        const paid = await chargeQueued({ id: report.id, company: report.company, url: report.url });
        if (paid === false) {
          await notifyOwner('Баланс кончился. Вакансия стоит 1 ₽.');
          break;
        }
      }

      if (report.verdict === 'human' && modelsDown(report.reason) === false)
        await notifyOwner(report.line);
    }
  }
  catch (error) {
    const text = error instanceof Error ? error.message.trim() : '';

    return json({ ok: added > 0, added, already: result.already, reason: text.length > 0 ? text.slice(0, 200) : 'скан упал' });
  }

  const reason = added === 0 ? idleReason(result.reports, result.already) : '';

  return json({ ok: true, added, already: result.already, reason });
}

function closedReason(live: boolean, auto: boolean, hours: boolean, day: boolean, room: boolean): string {
  if (live === false)
    return 'живой режим выкл';

  if (auto === false)
    return 'автопилот выкл';

  if (hours === false)
    return 'не рабочие часы';

  if (day === false)
    return 'день закрыт';

  if (room === false)
    return 'очередь полная';

  return '';
}

function idleReason(reports: { verdict: string; reason: string }[], already: number): string {
  const human = reports.find(report => report.verdict === 'human');
  if (human)
    return human.reason;

  if (reports.length === 0 && already > 0)
    return 'уже видели';

  const skip = reports.find(report => report.verdict === 'skip');
  if (skip)
    return skip.reason;

  return 'в очередь ничего не встало';
}

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
  const id = idOf(row.id) || idOf(urlId(row.url));
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (id.length === 0 || title.length === 0)
    return null;

  const url = typeof row.url === 'string' && row.url.includes('/vacancy/')
    ? row.url.split('?')[0]
    : `https://hh.ru/vacancy/${id}`;
  const foundBy = queryOf(row.query);

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
    ...(foundBy.length > 0 ? { foundBy } : {}),
  };
}

function queryOf(value: unknown): string {
  if (typeof value !== 'string')
    return '';

  return value.trim().slice(0, 80);
}

function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0)
    return String(value);

  if (typeof value !== 'string')
    return '';

  const id = value.trim();

  return /^\d+$/.test(id) ? id : '';
}

function urlId(value: unknown): string {
  if (typeof value !== 'string')
    return '';

  return value.match(/\/vacancy\/(\d+)/)?.[1] ?? '';
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

import type { LayoutServerLoad } from './$types';

import { moscowDay, readMemory, readQueue } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { coolLeft } from '$lib/server/admin-actions';
import { guestLinks, storedLinks } from '$lib/server/checks';
import { DEFAULT_QUERY, GUEST_BALANCE, isCreator, readAccount, VACANCY_RUB } from '$lib/server/secrets';

const when = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function statsOf(preview: boolean) {
  if (preview)
    return { today: 0, waiting: 0, queued: 0, judged: 0, rows: [] };

  const [memory, queue] = await Promise.all([readMemory(), readQueue()]);
  const day = moscowDay();
  const rows = queue.slice(0, 20).map(row => ({
    id: row.id,
    company: row.company,
    title: row.title,
    url: row.url,
    status: row.status,
    when: when.format(row.doneAt ?? row.at),
  }));

  return {
    today: queue.filter(row => row.status === 'sent' && moscowDay(new Date(row.doneAt ?? row.at)) === day).length,
    waiting: queue.filter(row => row.status === 'needsHuman').length,
    queued: queue.filter(row => row.status === 'pending').length,
    judged: memory.seen.length,
    rows,
  };
}
import { allowedLogins, readSession } from '$lib/server/session';

export const load: LayoutServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    redirect(303, '/');

  const creator = isCreator(session.login);
  const preview = creator && cookies.get('preview') === 'guest';
  const account = await readAccount(session.login);
  const links = preview ? guestLinks() : await storedLinks(session.login);
  return {
    login: preview ? 'гость' : session.login,
    preview,
    canPreview: creator,
    links,
    polling: preview ? false : telegramOn(),
    billing: {
      infinite: preview ? false : creator,
      balance: preview ? GUEST_BALANCE : account.balance,
      vacancyRub: VACANCY_RUB,
      history: creator && preview === false ? account.history.map(row => ({
        company: row.company,
        url: row.url,
        rub: row.rub,
        when: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(row.at),
      })) : [],
    },
    locks: {
      telegram: coolLeft('telegram'),
      mistral: coolLeft('mistral'),
      hh: coolLeft('hh'),
    },
    resumeId: preview ? '' : account.hhResumeId,
    hhQuery: preview ? '' : (account.hhQuery || DEFAULT_QUERY),
    hasExtToken: preview ? false : account.extToken.length > 0,
    stats: await statsOf(preview),
  };
};

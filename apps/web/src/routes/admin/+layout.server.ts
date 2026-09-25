import type { LayoutServerLoad } from './$types';

import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { coolLeft } from '$lib/server/admin-actions';
import { guestLinks, storedLinks } from '$lib/server/checks';
import { GUEST_BALANCE, isCreator, readAccount, VACANCY_RUB } from '$lib/server/secrets';
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
  };
};

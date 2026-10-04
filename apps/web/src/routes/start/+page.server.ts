import type { Actions, PageServerLoad } from './$types';

import { asProvider, watchRestart } from '@cursor-chrome/hh';
import { fail, redirect } from '@sveltejs/kit';
import { chainOf, ensureAccount, isCreator, readAccount, withChain, writeAccount } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';
import { weekOpen } from '$lib/server/week';

export const load: PageServerLoad = async ({ cookies, url }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || githubLogin(session.login) === false)
    redirect(303, '/');

  if (isCreator(session.login))
    return { demo: true, login: session.login, weekOpen: false, hasKey: false, connectUrl: '', spent: false };

  const account = await ensureAccount(session.login);
  const open = weekOpen(session.login, account);

  return {
    demo: false,
    login: session.login,
    weekOpen: open,
    hasKey: chainOf(account).length > 0,
    connectUrl: account.extToken.length > 0 ? `${url.origin}/connect#${account.extToken}` : '',
    spent: account.weekAt > 0 && open === false,
  };
};

export const actions: Actions = {
  key: async ({ request, cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || githubLogin(session.login) === false || isCreator(session.login))
      return fail(403, { reason: 'нет' });

    const form = await request.formData();
    const key = String(form.get('key') ?? '').trim();
    const provider = asProvider({ id: 'groq', key });
    if (provider === null)
      return fail(400, { reason: 'ключ не принят' });

    const account = await readAccount(session.login);
    await writeAccount(session.login, withChain(account, [provider]));

    return { saved: true };
  },
  enable: async ({ cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || githubLogin(session.login) === false || isCreator(session.login))
      return fail(403, { reason: 'нет' });

    const account = await readAccount(session.login);
    if (weekOpen(session.login, account) === false || chainOf(account).length === 0)
      return fail(400, { reason: 'неделя кончилась' });

    account.hhLive = '1';
    await writeAccount(session.login, account);
    await watchRestart();

    return { started: true };
  },
};

import type { Actions, PageServerLoad } from './$types';

import { fail, redirect } from '@sveltejs/kit';
import { ensureAccount, isCreator, listLogins, readAccount, writeAccount } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';
import { weekLoad, weekOpen } from '$lib/server/week';

export const load: PageServerLoad = async ({ parent }) => {
  const { canPreview, preview } = await parent();
  if (canPreview === false)
    redirect(303, '/admin');

  if (preview)
    return { people: [] };

  const logins = await listLogins();
  const people = [];
  for (const login of logins) {
    if (isCreator(login))
      continue;

    const account = await readAccount(login);
    people.push({
      login,
      open: weekOpen(login, account),
      load: Math.round(weekLoad(account) * 100),
    });
  }

  return { people };
};

export const actions: Actions = {
  open: async ({ request, cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || isCreator(session.login) === false || cookies.get('preview') === 'guest')
      return fail(403, { reason: 'нет' });

    const form = await request.formData();
    const login = String(form.get('login') ?? '');
    if (githubLogin(login) === false || isCreator(login))
      return fail(400, { reason: 'нет такого' });

    const account = await ensureAccount(login);
    account.weekAt = Date.now();
    account.weekMinutes = 0;
    account.weekClicks = 0;
    account.weekDevices = {};
    await writeAccount(login, account);

    return { opened: login };
  },
};

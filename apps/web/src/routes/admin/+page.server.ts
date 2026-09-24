import type { Actions, PageServerLoad } from './$types';
import type { Secrets } from '$lib/server/secrets';

import { telegramOn } from '@cursor-chrome/telegram';
import { error, redirect } from '@sveltejs/kit';
import { checkLinks } from '$lib/server/checks';
import { publishSecrets, readSecrets, secretValue, writeSecrets } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

const fields = ['telegramToken', 'mistralKey', 'hhAccessToken', 'hhResumeId'] as const;

export const load: PageServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    redirect(303, '/');

  const saved = await readSecrets();
  const links = await checkLinks();
  const set = Object.fromEntries(fields.map(key => [key, secretValue(key, saved).length > 0]));
  return { login: session.login, links, set, polling: telegramOn() };
};

export const actions: Actions = {
  save: async ({ request, cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || allowedLogins().includes(session.login) === false)
      error(401, 'нет');

    const form = await request.formData();
    const saved = await readSecrets();
    const next: Secrets = { ...saved };
    for (const key of fields) {
      const value = String(form.get(key) ?? '').trim();
      if (value.length > 0)
        next[key] = value;
    }

    await writeSecrets(next);
    publishSecrets(next);
    return { saved: true };
  },
};

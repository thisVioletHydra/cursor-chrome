import type { LayoutServerLoad } from './$types';

import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { checkLinks } from '$lib/server/checks';
import { readSecrets, secretValue } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

const fields = ['telegramToken', 'mistralKey', 'hhAccessToken', 'hhResumeId'] as const;

export const load: LayoutServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    redirect(303, '/');

  const saved = await readSecrets();
  const links = await checkLinks();
  const set = Object.fromEntries(fields.map(key => [key, secretValue(key, saved).length > 0]));
  return { login: session.login, links, set, polling: telegramOn() };
};

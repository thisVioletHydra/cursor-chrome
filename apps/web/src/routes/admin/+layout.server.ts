import type { LayoutServerLoad } from './$types';

import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { storedLinks } from '$lib/server/checks';
import { allowedLogins, readSession } from '$lib/server/session';

export const load: LayoutServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    redirect(303, '/');

  const links = await storedLinks();
  return { login: session.login, links, polling: telegramOn() };
};

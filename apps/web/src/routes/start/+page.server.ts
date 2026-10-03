import type { PageServerLoad } from './$types';

import { redirect } from '@sveltejs/kit';
import { isCreator } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

export const load: PageServerLoad = ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false || isCreator(session.login) === false)
    redirect(303, '/');

  return { login: session.login };
};

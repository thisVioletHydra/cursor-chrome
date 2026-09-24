import type { PageServerLoad } from './$types';

import { redirect } from '@sveltejs/kit';
import { allowedLogins, readSession } from '$lib/server/session';

export const load: PageServerLoad = ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  const allowed = session !== null && allowedLogins().includes(session.login);
  if (allowed)
    redirect(303, '/admin');

  return {};
};

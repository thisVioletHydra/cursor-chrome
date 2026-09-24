import type { PageServerLoad } from './$types';

import { redirect } from '@sveltejs/kit';
import { allowedLogins, readSession } from '$lib/server/session';

import process from 'node:process';

export const load: PageServerLoad = ({ cookies, url }) => {
  const session = readSession(cookies.get('session'));
  const allowed = session !== null && allowedLogins().includes(session.login);
  if (allowed)
    redirect(303, '/admin');

  const ready = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  return {
    ready,
    callback: `${url.origin}/auth/callback`,
  };
};

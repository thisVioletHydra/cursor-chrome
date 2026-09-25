import type { RequestHandler } from './$types';

import { redirect } from '@sveltejs/kit';

import process from 'node:process';

export const GET: RequestHandler = ({ cookies, url }) => {
  const id = process.env.GITHUB_CLIENT_ID ?? '';
  if (id.length === 0)
    redirect(303, '/?blocked=1');

  const state = crypto.randomUUID();
  cookies.set('oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 600 });
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', id);
  auth.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  auth.searchParams.set('scope', 'read:user');
  auth.searchParams.set('state', state);
  auth.searchParams.set('allow_signup', 'true');
  redirect(303, auth.toString());
};

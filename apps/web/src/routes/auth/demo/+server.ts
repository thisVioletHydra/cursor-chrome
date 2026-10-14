// DEMO_TOKEN_LOGIN — temporary demo login by access token, bypassing GitHub. Remove this file to cut it out.
import type { RequestHandler } from './$types';

import { error, redirect } from '@sveltejs/kit';
import { accessStore, demoLoginAllowed } from '$lib/server/access';
import { readProfile } from '$lib/server/profile';
import { githubLogin, signSession } from '$lib/server/session';

import process from 'node:process';

export const GET: RequestHandler = async ({ url, cookies }) => {
  if (process.env.DEMO_TOKEN_LOGIN !== '1' || process.env.RAILWAY_ENVIRONMENT)
    error(404, 'нет');

  const login = accessStore().loginOf(url.searchParams.get('token') ?? '');
  // only demo accounts, never the owner
  if (demoLoginAllowed(process.env, login) === false || githubLogin(login ?? '') === false)
    error(403, 'токен не подходит для демо-входа');

  cookies.set('session', signSession(login!), { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
  redirect(303, (await readProfile(login!)) === null ? '/admin/profile?first=1' : '/admin');
};

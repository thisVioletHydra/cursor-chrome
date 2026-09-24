import type { RequestHandler } from './$types';

import { error, redirect } from '@sveltejs/kit';
import { allowedLogins, signSession } from '$lib/server/session';

import process from 'node:process';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (code === null || code.length === 0 || state !== cookies.get('oauth_state'))
    error(400, 'битый вход');

  cookies.delete('oauth_state', { path: '/' });

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const token = await tokenRes.json() as { access_token?: string };
  if (token.access_token === null || token.access_token === undefined)
    error(401, 'GitHub не дал токен');

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'cursor-chrome-web',
    },
  });
  const user = await userRes.json() as { login?: string };
  if (!user.login || allowedLogins().includes(user.login) === false)
    error(403, 'этот GitHub сюда не входит');

  cookies.set('session', signSession(user.login), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect(303, '/admin');
};

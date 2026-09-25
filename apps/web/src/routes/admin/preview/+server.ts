import type { RequestHandler } from './$types';

import { error, redirect } from '@sveltejs/kit';
import { isCreator } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

export const POST: RequestHandler = ({ cookies, request, url }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false || isCreator(session.login) === false)
    error(403, 'нет');

  const back = request.headers.get('referer') ?? '';
  const next = back.startsWith(url.origin) ? back : '/admin';
  if (cookies.get('preview') === 'guest')
    cookies.delete('preview', { path: '/' });
  else
    cookies.set('preview', 'guest', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: 60 * 60 * 12,
    });

  redirect(303, next);
};

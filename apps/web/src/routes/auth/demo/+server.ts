// DEMO_TOKEN_LOGIN: token login for vasya-pupkin only (see $lib/server/demo). POST from the login form; the token never goes into a URL.
import type { RequestHandler } from './$types';

import { error, redirect } from '@sveltejs/kit';
import { accessStore } from '$lib/server/access';
import { demoLoginFor, demoToken } from '$lib/server/demo';
import { readProfile } from '$lib/server/profile';
import { signSession } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, url, cookies }) => {
  if (!demoToken())
    error(404, 'нет');

  const form = await request.formData().catch(() => null);
  const login = demoLoginFor(accessStore(), String(form?.get('token') ?? ''));
  if (login === null)
    redirect(303, '/?token=bad');

  cookies.set('session', signSession(login), { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
  redirect(303, (await readProfile(login)) === null ? '/admin/profile?first=1' : '/admin');
};

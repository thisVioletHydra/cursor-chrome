import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { saveProfile } from '$lib/server/profile';
import { reviewLogin } from '$lib/server/review';

export const POST: RequestHandler = async (event) => {
  const login = reviewLogin(event);
  const body = await event.request.json().catch(() => null) as unknown;
  const profile = await saveProfile(login, body);

  return profile ? json({ ok: true, profile }) : json({ ok: false, detail: 'не разобрал профиль' }, { status: 400 });
};

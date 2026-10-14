import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { draftCard, reviewLogin } from '$lib/server/review';

export const POST: RequestHandler = async (event) => {
  const login = reviewLogin(event);
  const body = await event.request.json().catch(() => null) as { id?: unknown } | null;
  const id = String(body?.id ?? '').trim();
  if (/^\d+$/.test(id) === false)
    return json({ error: 'нет вакансии' }, { status: 400 });

  return json(await draftCard(login, id));
};

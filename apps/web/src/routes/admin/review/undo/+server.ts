import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { reviewLogin, undoDecision } from '$lib/server/review';

export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as { id?: unknown } | null;
  const id = String(body?.id ?? '').trim();
  if (/^\d+$/.test(id) === false)
    return json({ ok: false, detail: 'нет вакансии' }, { status: 400 });

  return json(await undoDecision(id));
};

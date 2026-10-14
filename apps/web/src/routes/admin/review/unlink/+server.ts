import type { RequestHandler } from './$types';

import { dropDraft, questionKey, unlinkAnswer } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { reviewLogin } from '$lib/server/review';

// «отвязать»: this question never gets that memory/canon answer again (persisted per question).
export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as { id?: unknown; prompt?: unknown; target?: unknown } | null;
  const id = String(body?.id ?? '').trim();
  const prompt = String(body?.prompt ?? '').trim().slice(0, 1_000);
  const target = String(body?.target ?? '').trim().slice(0, 400);
  if (/^\d+$/.test(id) === false || prompt.length === 0 || /^[cm]:/.test(target) === false)
    return json({ ok: false, detail: 'id, prompt, target' }, { status: 400 });

  await unlinkAnswer(prompt, target);
  await dropDraft(id, questionKey(prompt));

  return json({ ok: true });
};

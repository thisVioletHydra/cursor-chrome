import type { RequestHandler } from './$types';

import { ruleFromAnswer } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { reviewLogin } from '$lib/server/review';

// «запомнить как правило»: the answer becomes (or replaces) a canon rule for this question.
export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as { prompt?: unknown; answer?: unknown; source?: unknown } | null;
  const prompt = String(body?.prompt ?? '').trim().slice(0, 1_000);
  const answer = String(body?.answer ?? '').trim().slice(0, 4_000);
  const source = String(body?.source ?? '').trim().slice(0, 400);
  if (prompt.length === 0 || answer.length === 0)
    return json({ ok: false, detail: 'нужны вопрос и ответ' }, { status: 400 });

  const item = await ruleFromAnswer({ prompt, answer, source: /^[cm]:/.test(source) ? source : undefined });

  return json({ ok: true, item });
};

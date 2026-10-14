import type { RequestHandler } from './$types';
import type { DecisionAnswer, ReviewAction } from '@cursor-chrome/hh';

import { json } from '@sveltejs/kit';
import { decide, reviewLogin } from '$lib/server/review';

const ACTIONS: readonly ReviewAction[] = ['approved', 'rejected', 'later'];

type Body = { id?: unknown; action?: unknown; reason?: unknown; answers?: unknown };

function answersOf(raw: unknown): DecisionAnswer[] {
  if (Array.isArray(raw) === false)
    return [];

  return raw.slice(0, 30).flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null)
      return [];

    const item = row as Record<string, unknown>;
    const prompt = String(item.prompt ?? '').slice(0, 1_000);
    const answer = String(item.answer ?? '').slice(0, 4_000);

    const source = /^[cm]:/.test(String(item.source ?? '')) ? String(item.source).slice(0, 400) : undefined;

    return prompt.length > 0 ? [{ key: String(item.key ?? '').slice(0, 300), prompt, answer, ...(source ? { source } : {}), edited: item.edited === true, kind: String(item.kind ?? '').slice(0, 20), options: Array.isArray(item.options) ? item.options.slice(0, 50).map(option => String(option).slice(0, 300)) : [] }] : [];
  });
}

export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as Body | null;
  const id = String(body?.id ?? '').trim();
  const action = String(body?.action ?? '') as ReviewAction;
  if (/^\d+$/.test(id) === false || ACTIONS.includes(action) === false)
    return json({ ok: false, detail: 'id и action' }, { status: 400 });

  return json(await decide({ id, action, reason: String(body?.reason ?? '').trim(), answers: answersOf(body?.answers) }));
};

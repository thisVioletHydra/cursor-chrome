import type { RequestHandler } from './$types';

import { aliasesOf, deleteCanon, listCanon, saveCanon } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { reviewLogin } from '$lib/server/review';

type Body = { id?: unknown; title?: unknown; answer?: unknown; aliases?: unknown };

export const GET: RequestHandler = async (event) => {
  reviewLogin(event);

  return json({ items: await listCanon() });
};

export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as Body | null;
  const title = String(body?.title ?? '').trim();
  const answer = String(body?.answer ?? '').trim();
  if (title.length === 0 || answer.length === 0)
    return json({ ok: false, detail: 'нужны название и ответ' }, { status: 400 });

  const id = Number(body?.id ?? 0);
  const item = await saveCanon({ id: Number.isInteger(id) && id > 0 ? id : undefined, title, answer, aliases: aliasesOf(body?.aliases) });

  return json({ ok: true, item });
};

export const DELETE: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as Body | null;
  const id = Number(body?.id ?? 0);
  if (Number.isInteger(id) === false || id <= 0)
    return json({ ok: false, detail: 'нет id' }, { status: 400 });

  await deleteCanon(id);

  return json({ ok: true });
};

import type { RequestHandler } from './$types';

import { aliasesOf, deleteEntry, entryToMemory, entryToRule, listEntries, unlinkLinked, updateEntry } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { reviewLogin } from '$lib/server/review';

type Body = { op?: unknown; id?: unknown; answer?: unknown; prompt?: unknown; aliases?: unknown; linked?: unknown };

const ID = /^(m:.{1,400}|c:\d+)$/s;

// One endpoint for the «Память» tab; every op answers with the fresh list.
export const POST: RequestHandler = async (event) => {
  reviewLogin(event);
  const body = await event.request.json().catch(() => null) as Body | null;
  const op = String(body?.op ?? '');
  const id = String(body?.id ?? '');
  if (ID.test(id) === false)
    return json({ ok: false, detail: 'нет id' }, { status: 400 });

  let next: string | null = id;
  if (op === 'edit') {
    const ok = await updateEntry(id, {
      answer: String(body?.answer ?? ''),
      prompt: body?.prompt === undefined ? undefined : String(body.prompt).slice(0, 300),
      aliases: body?.aliases === undefined ? undefined : aliasesOf(body.aliases),
    });
    if (ok === false)
      return json({ ok: false, detail: 'пустой ответ или запись пропала' }, { status: 400 });
  }
  else if (op === 'delete')
    await deleteEntry(id);
  else if (op === 'to-rule')
    next = await entryToRule(id);
  else if (op === 'to-memory')
    next = await entryToMemory(id);
  else if (op === 'unlink') {
    const prompt = String(body?.linked ?? '').trim().slice(0, 1_000);
    if (prompt.length === 0)
      return json({ ok: false, detail: 'нет вопроса' }, { status: 400 });

    await unlinkLinked(id, prompt);
  }
  else
    return json({ ok: false, detail: 'op' }, { status: 400 });

  return json({ ok: true, id: next, entries: await listEntries() });
};

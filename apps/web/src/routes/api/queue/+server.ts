import type { RequestHandler } from './$types';

import { COVER_LETTER, dayOpen, pending, readMemory, workHours } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [memory, account] = await Promise.all([readMemory(), readAccount(login)]);
  const letter = account.coverLetter || COVER_LETTER;
  if (workHours() === false || dayOpen(memory) === false)
    return json({ items: [], letter });

  const items = await pending(10);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    letter,
  });
};

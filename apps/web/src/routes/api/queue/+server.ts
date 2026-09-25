import type { RequestHandler } from './$types';

import { COVER_LETTER, pending } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [items, account] = await Promise.all([pending(10), readAccount(login)]);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    letter: account.coverLetter || COVER_LETTER,
  });
};

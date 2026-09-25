import type { RequestHandler } from './$types';

import { pending } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';

export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const items = await pending(10);

  return json({ items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })) });
};

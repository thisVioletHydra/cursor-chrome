import type { RequestHandler } from './$types';

import { COVER_LETTER, dayOpen, pending, pendingCount, QUEUE_TARGET, readMemory, readState, splitQueries, workHours } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { DEFAULT_QUERY, readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [memory, account, state] = await Promise.all([readMemory(), readAccount(login), readState()]);
  const letter = account.coverLetter || COVER_LETTER;
  const queries = splitQueries(account.hhQuery || DEFAULT_QUERY);
  const open = workHours() && dayOpen(memory);
  if (open === false)
    return json({ items: [], letter, queries, want: false, imitation: account.imitation });

  const queued = await pendingCount();
  const want = account.hhLive === '1' && state.auto && queued < QUEUE_TARGET;
  const items = await pending(10);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    letter,
    queries,
    want,
    imitation: account.imitation,
  });
};

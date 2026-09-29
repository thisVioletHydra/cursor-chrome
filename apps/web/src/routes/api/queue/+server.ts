import type { RequestHandler } from './$types';

import { COVER_LETTER, dayOpen, diaryIds, pending, pendingCount, QUEUE_TARGET, readMemory, readQueue, readState, serveQueries, splitQueries, takePilotStart, workHours, writeState } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { DEFAULT_QUERY, readAccount } from '$lib/server/secrets';

export const GET: RequestHandler = async ({ request, url }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const [memory, account, state] = await Promise.all([readMemory(), readAccount(login), readState()]);
  const letter = account.coverLetter || COVER_LETTER;
  const saved = splitQueries(account.hhQuery || DEFAULT_QUERY);
  const stop = state.hung === true && state.auto === false;
  const auto = state.auto === true;
  const listen = url.searchParams.get('listen') === '1';
  const start = listen ? takePilotStart() : false;
  const hours = account.hhHours !== '0';
  const open = (hours === false || workHours()) && dayOpen(memory);
  if (open === false)
    return json({ items: [], letter, queries: saved, want: false, imitation: account.imitation, stop, hours, auto, start });

  const queued = await pendingCount();
  const want = account.hhLive === '1' && state.auto && queued < QUEUE_TARGET;
  const cycle = url.searchParams.get('cycle') === '1';
  const queries = want && listen === false ? await shownPass(saved, state, cycle) : saved;
  const items = await pending(10);
  const seen = listen ? null : await huntDiary(memory.seen);

  return json({
    items: items.map(row => ({ id: row.id, company: row.company, title: row.title, url: row.url })),
    letter,
    queries,
    want,
    imitation: account.imitation,
    stop,
    hours,
    auto,
    start,
    ...(seen === null ? {} : { seen }),
  });
};

async function shownPass(saved: string[], state: { frontAt: number; lessAt: number; queryPass: number }, advance: boolean): Promise<string[]> {
  const served = serveQueries(saved, {
    frontAt: state.frontAt,
    lessAt: state.lessAt,
    queryPass: state.queryPass,
  }, advance);
  if (served.cursor.frontAt !== state.frontAt || served.cursor.lessAt !== state.lessAt || served.cursor.queryPass !== state.queryPass)
    await writeState({ frontAt: served.cursor.frontAt, lessAt: served.cursor.lessAt, queryPass: served.cursor.queryPass });

  return served.queries;
}

async function huntDiary(seen: string[]): Promise<string[]> {
  const queue = await readQueue();

  return diaryIds(seen, queue.map(row => row.id));
}

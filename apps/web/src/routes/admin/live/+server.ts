import type { RequestHandler } from './$types';

import { hiddenCount, passedCount, readMemory, readPassed, readQueue, readState, seenCount, watchView } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { pruneShelvedWaiters } from '$lib/server/admin-actions';
import { boardFrom } from '$lib/server/board';
import { isCreator } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

const blank = {
  polling: false,
  figures: {
    today: 0,
    queued: 0,
    waiting: 0,
    accepted: 0,
    stale: 0,
    passedTotal: 0,
    invitations: 0,
    discards: 0,
    waitingReply: 0,
    hidden: 0,
  },
  rows: [],
  passed: [],
  autopilot: { auto: false, lastNote: '', runAt: 0 },
  judged: 0,
  pulse: { line: '' },
  log: [],
};

export const GET: RequestHandler = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || githubLogin(session.login) === false)
    return json({ error: 'нет' }, { status: 401 });

  if (isCreator(session.login) && cookies.get('preview') === 'guest')
    return json(blank);

  const [loaded, state, judged, hidden, passed, passedTotal, memory] = await Promise.all([readQueue(), readState(), seenCount(), hiddenCount(), readPassed(), passedCount(), readMemory()]);
  const queue = await pruneShelvedWaiters(loaded);
  const watch = watchView();
  const board = boardFrom(queue, passed);

  return json({
    polling: telegramOn(),
    figures: {
      today: memory.sent,
      queued: queue.filter(row => row.status === 'pending').length,
      waiting: board.waiting,
      accepted: board.accepted,
      stale: board.stale,
      passedTotal,
      invitations: queue.filter(row => row.outcome === 'invitation').length,
      discards: queue.filter(row => row.outcome === 'discard').length,
      waitingReply: queue.filter(row => row.outcome === 'response').length,
      hidden,
    },
    rows: board.rows,
    passed: board.passed,
    autopilot: { auto: state.auto, lastNote: state.lastNote, runAt: state.auto ? state.runAt : 0 },
    judged,
    pulse: watch.pulse,
    log: watch.rows,
  });
};

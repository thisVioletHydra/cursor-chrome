import type { RequestHandler } from './$types';

import { hiddenCount, passedCount, readMemory, readPassed, readQueue, readState, seenCount, watchView } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { pruneShelvedWaiters } from '$lib/server/admin-actions';
import { boardFrom } from '$lib/server/board';
import { githubLogin, readSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || githubLogin(session.login) === false)
    return json({ error: 'нет' }, { status: 401 });

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

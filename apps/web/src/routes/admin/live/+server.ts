import type { RequestHandler } from './$types';

import { hiddenCount, moscowDay, passedCount, readPassed, readQueue, readState, seenCount, watchView } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { boardFrom } from '$lib/server/board';
import { allowedLogins, readSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    return json({ error: 'нет' }, { status: 401 });

  const [queue, state, judged, hidden, passed, passedTotal] = await Promise.all([readQueue(), readState(), seenCount(), hiddenCount(), readPassed(), passedCount()]);
  const day = moscowDay();
  const watch = watchView();
  const board = boardFrom(queue, passed);

  return json({
    polling: telegramOn(),
    figures: {
      today: queue.filter(row => row.status === 'sent' && moscowDay(new Date(row.doneAt ?? row.at)) === day).length,
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

import type { RequestHandler } from './$types';

import { moscowDay, readQueue, readState, seenCount, watchView } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { json } from '@sveltejs/kit';
import { allowedLogins, readSession } from '$lib/server/session';

const when = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const GET: RequestHandler = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    return json({ error: 'нет' }, { status: 401 });

  const [queue, state, judged] = await Promise.all([readQueue(), readState(), seenCount()]);
  const day = moscowDay();
  const watch = watchView();

  return json({
    polling: telegramOn(),
    figures: {
      today: queue.filter(row => row.status === 'sent' && moscowDay(new Date(row.doneAt ?? row.at)) === day).length,
      queued: queue.filter(row => row.status === 'pending').length,
      waiting: queue.filter(row => row.status === 'needsHuman').length,
      invitations: queue.filter(row => row.outcome === 'invitation').length,
      discards: queue.filter(row => row.outcome === 'discard').length,
      waitingReply: queue.filter(row => row.outcome === 'response').length,
    },
    rows: queue.slice(0, 20).map(row => ({
      id: row.id,
      company: row.company,
      title: row.title,
      url: row.url,
      status: row.status,
      when: when.format(row.doneAt ?? row.at),
    })),
    autopilot: { auto: state.auto, lastNote: state.lastNote },
    judged,
    pulse: watch.pulse,
    log: watch.rows,
  });
};

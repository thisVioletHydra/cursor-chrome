import type { Actions, PageServerLoad } from './$types';

import { atsFirst } from '@cursor-chrome/hh';
import { scanAtsAdmin } from '$lib/server/admin-actions';
import { readAtsScan, readResume } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview, resumeId, providers } = await parent();
  const askName = atsFirst(providers)?.name ?? 'модель';
  const none = { linked: false, chars: 0, fetchedAt: 0, scan: null, askName };
  if (preview)
    return none;

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { ...none, linked: resumeId.length > 0 };

  const resume = await readResume(session.login);
  const held = resume !== null && resume.id === resumeId ? resume : null;
  const chars = held === null ? 0 : held.text.length;
  const fetchedAt = held === null ? 0 : held.at;
  const saved = await readAtsScan(session.login);
  if (saved === null || saved.resumeAt === 0 || held === null)
    return { linked: resumeId.length > 0, chars, fetchedAt, scan: null, askName };

  return {
    linked: true,
    chars,
    fetchedAt,
    askName,
    scan: {
      score: saved.score,
      flags: saved.flags,
      via: saved.via,
      at: saved.at,
      stale: saved.resumeAt !== held.at,
      outdated: saved.outdated,
    },
  };
};

export const actions: Actions = {
  scan: scanAtsAdmin,
};

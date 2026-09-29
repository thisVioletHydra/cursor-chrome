import type { Actions, PageServerLoad } from './$types';

import { atsFirst } from '@cursor-chrome/hh';
import { scanAtsAdmin } from '$lib/server/admin-actions';
import { readAtsScan, readResume } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview, resumeId, providers } = await parent();
  const askName = atsFirst(providers)?.name ?? 'модель';
  if (preview)
    return { linked: false, text: '', scan: null, askName };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { linked: resumeId.length > 0, text: '', scan: null, askName };

  const resume = await readResume(session.login);
  const text = resume !== null && resume.id === resumeId ? resume.text : '';
  const saved = await readAtsScan(session.login);
  if (saved === null || saved.resumeAt === 0 || text.length === 0 || resume === null)
    return { linked: resumeId.length > 0, text, scan: null, askName };

  return {
    linked: true,
    text,
    askName,
    scan: {
      score: saved.score,
      flags: saved.flags,
      via: saved.via,
      at: saved.at,
      stale: saved.resumeAt !== resume.at,
      outdated: saved.outdated,
    },
  };
};

export const actions: Actions = {
  scan: scanAtsAdmin,
};

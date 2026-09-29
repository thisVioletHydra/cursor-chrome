import type { Actions, PageServerLoad } from './$types';

import { scanAtsAdmin } from '$lib/server/admin-actions';
import { readAtsScan, readResume } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview, resumeId } = await parent();
  if (preview)
    return { linked: false, text: '', scan: null };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { linked: resumeId.length > 0, text: '', scan: null };

  const resume = await readResume(session.login);
  const text = resume !== null && resume.id === resumeId ? resume.text : '';
  const saved = await readAtsScan(session.login);
  if (saved === null || saved.resumeAt === 0 || text.length === 0 || resume === null)
    return { linked: resumeId.length > 0, text, scan: null };

  return {
    linked: true,
    text,
    scan: {
      score: saved.score,
      flags: saved.flags,
      via: saved.via,
      at: saved.at,
      stale: saved.resumeAt !== resume.at,
    },
  };
};

export const actions: Actions = {
  scan: scanAtsAdmin,
};

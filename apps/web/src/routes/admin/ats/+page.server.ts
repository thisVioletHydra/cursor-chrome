import type { Actions, PageServerLoad } from './$types';

import { atsSource } from '@cursor-chrome/hh';
import { scanAtsAdmin } from '$lib/server/admin-actions';
import { readAtsScan } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview, coverLetter } = await parent();
  const letter = preview ? '' : coverLetter;
  const source = atsSource(letter);
  if (preview)
    return { source, scan: null };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { source, scan: null };

  const saved = await readAtsScan(session.login);
  if (saved === null)
    return { source, scan: null };

  return {
    source,
    scan: {
      score: saved.score,
      flags: saved.flags,
      via: saved.via,
      at: saved.at,
      stale: saved.letter !== letter,
    },
  };
};

export const actions: Actions = {
  scan: scanAtsAdmin,
};

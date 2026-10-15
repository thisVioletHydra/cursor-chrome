import type { PageServerLoad } from './$types';

import { listCanon, parseCanonSeed, seedCanonOnce } from '@cursor-chrome/hh';
import { readAccount } from '$lib/server/secrets';
import { redirect } from '@sveltejs/kit';
import { readProfile } from '$lib/server/profile';
import { REJECT_REASONS, reviewBoard, reviewLogin } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  const login = reviewLogin(event);
  // first login: the questionnaire comes before the first review
  if ((await readProfile(login)) === null)
    redirect(303, '/admin/profile?first=1');

  await seedCanonOnce(parseCanonSeed((await readAccount(login)).canonSeed));
  const [board, canon] = await Promise.all([reviewBoard(login), listCanon()]);

  return { ...board, canon, reasons: [...REJECT_REASONS] };
};

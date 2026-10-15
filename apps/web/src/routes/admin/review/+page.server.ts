import type { PageServerLoad } from './$types';

import { listCanon, parseCanonSeed, seedCanonOnce } from '@cursor-chrome/hh';
import { readAccount } from '$lib/server/secrets';
import { REJECT_REASONS, reviewBoard, reviewLogin } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  const login = reviewLogin(event);
  await seedCanonOnce(parseCanonSeed((await readAccount(login)).canonSeed));
  const [board, canon] = await Promise.all([reviewBoard(login), listCanon()]);

  return { ...board, canon, reasons: [...REJECT_REASONS] };
};

import type { PageServerLoad } from './$types';

import { listEntries } from '@cursor-chrome/hh';
import { reviewLogin } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  reviewLogin(event);

  return { entries: await listEntries() };
};

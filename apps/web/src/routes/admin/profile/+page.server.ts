import type { PageServerLoad } from './$types';

import { PROFILE_QUESTIONS } from '@cursor-chrome/hh';
import { readProfile } from '$lib/server/profile';
import { reviewLogin } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  const login = reviewLogin(event);

  return { questions: PROFILE_QUESTIONS, profile: await readProfile(login), first: event.url.searchParams.get('first') === '1' };
};

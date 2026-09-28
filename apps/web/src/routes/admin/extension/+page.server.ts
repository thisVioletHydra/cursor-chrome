import type { Actions, PageServerLoad } from './$types';

import { issueExtTokenAdmin } from '$lib/server/admin-actions';

export const load: PageServerLoad = async ({ url }) => {
  return { origin: url.origin };
};

export const actions: Actions = {
  extToken: issueExtTokenAdmin,
};

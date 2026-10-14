import type { Actions, PageServerLoad } from './$types';

import { issueExtTokenAdmin } from '$lib/server/admin-actions';

export const load: PageServerLoad = async ({ url, parent }) => {
  // extToken itself is never in load data: the client fetches it via POST /admin/ext-token on click.
  const { hasExtToken } = await parent();
  return { origin: url.origin, hasExtToken };
};

export const actions: Actions = {
  extToken: issueExtTokenAdmin,
};

import type { Actions } from './$types';

import { unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  verify: verifyAdmin,
  unlink: unlinkAdmin,
};

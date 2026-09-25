import type { Actions } from './$types';

import { saveResumeAdmin, unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  verify: verifyAdmin,
  resume: saveResumeAdmin,
  unlink: unlinkAdmin,
};

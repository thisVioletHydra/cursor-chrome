import type { Actions } from './$types';

import { issueExtTokenAdmin, saveQueryAdmin, saveResumeAdmin, unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  verify: verifyAdmin,
  resume: saveResumeAdmin,
  query: saveQueryAdmin,
  extToken: issueExtTokenAdmin,
  unlink: unlinkAdmin,
};

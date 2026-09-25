import type { Actions } from './$types';

import { issueExtTokenAdmin, saveQueryAdmin, saveResumeAdmin, suggestQueryAdmin, unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  verify: verifyAdmin,
  resume: saveResumeAdmin,
  query: saveQueryAdmin,
  suggest: suggestQueryAdmin,
  extToken: issueExtTokenAdmin,
  unlink: unlinkAdmin,
};

import type { Actions } from './$types';

import { importSetupAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  import: importSetupAdmin,
};

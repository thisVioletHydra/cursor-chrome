import type { Actions } from './$types';

import { addProviderAdmin, raiseProviderAdmin, removeProviderAdmin, unlinkAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  add: addProviderAdmin,
  remove: removeProviderAdmin,
  raise: raiseProviderAdmin,
  unlink: unlinkAdmin,
};

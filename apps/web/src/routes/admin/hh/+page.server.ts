import type { Actions } from './$types';

import { saveAdmin, undoAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  save: saveAdmin,
  undo: undoAdmin,
};

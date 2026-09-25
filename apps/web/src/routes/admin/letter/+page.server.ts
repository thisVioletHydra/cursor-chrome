import type { Actions } from './$types';

import { saveLetterAdmin } from '$lib/server/admin-actions';

export const actions: Actions = {
  save: saveLetterAdmin,
};

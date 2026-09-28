import type { Actions, PageServerLoad } from './$types';

import { readProbeLog } from '@cursor-chrome/hh';
import { addProviderAdmin, raiseProviderAdmin, removeProviderAdmin, unlinkAdmin } from '$lib/server/admin-actions';

export const load: PageServerLoad = async ({ parent }) => {
  const { preview } = await parent();
  if (preview)
    return { probes: [] };

  const notes = await readProbeLog();

  return {
    probes: notes.slice(-16).reverse().map(row => ({
      name: row.name,
      model: row.model,
      ok: row.ok,
      detail: row.detail,
    })),
  };
};

export const actions: Actions = {
  add: addProviderAdmin,
  remove: removeProviderAdmin,
  raise: raiseProviderAdmin,
  unlink: unlinkAdmin,
};

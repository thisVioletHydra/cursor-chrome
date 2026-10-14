import type { Actions, PageServerLoad } from './$types';

import { readProbeLog } from '@cursor-chrome/hh';
import { redirect } from '@sveltejs/kit';
import { isDemoLogin } from '$lib/server/demo';
import { readSession } from '$lib/server/session';
import { addProviderAdmin, raiseProviderAdmin, removeProviderAdmin, unlinkAdmin, wizardProviderAdmin } from '$lib/server/admin-actions';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview, canPreview } = await parent();
  // the demo account sets up its own BYOK chain (key wizard) here
  if (canPreview === false && !isDemoLogin(readSession(cookies.get('session'))?.login))
    redirect(303, '/start');

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
  wizard: wizardProviderAdmin,
};

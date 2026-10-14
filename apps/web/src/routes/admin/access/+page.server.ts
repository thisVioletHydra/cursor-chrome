import type { Actions, PageServerLoad } from './$types';

import { error } from '@sveltejs/kit';
import { accessStore, PASS_MS, SLOTS, WEIGHTS } from '$lib/server/access';
import { isCreator } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

// Debug panel: tokens (hash ids only), device slots, last score, passes, access log.
export const load: PageServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  const store = accessStore();
  const mine = (row: { login: string }) => session !== null && (isCreator(session.login) || row.login === session.login);

  return { tokens: store.list().filter(mine), events: store.events(60), weights: WEIGHTS, slots: SLOTS, passHours: PASS_MS / 3_600_000, login: session?.login ?? '' };
};

export const actions: Actions = {
  unbind: async ({ request, cookies }) => {
    const session = readSession(cookies.get('session'));
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const row = accessStore().list().find(item => item.id === id);
    if (!session || !row || (isCreator(session.login) === false && row.login !== session.login))
      error(403, 'нет');

    accessStore().unbind(id, Number(form.get('slot')));

    return { ok: true };
  },
};

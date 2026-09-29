import type { Actions, PageServerLoad } from './$types';

import { saveImitationAdmin } from '$lib/server/admin-actions';
import { IMITATION, readAccount } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview } = await parent();
  if (preview)
    return { pace: { ...IMITATION }, hours: true };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { pace: { ...IMITATION }, hours: true };

  const account = await readAccount(session.login);

  return { pace: account.imitation, hours: account.hhHours !== '0' };
};

export const actions: Actions = {
  save: saveImitationAdmin,
};

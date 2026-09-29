import type { Actions, PageServerLoad } from './$types';

import { restartAdmin, setHoursAdmin, setLiveAdmin } from '$lib/server/admin-actions';
import { readAccount } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview } = await parent();
  if (preview)
    return { hours: true };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { hours: true };

  const account = await readAccount(session.login);

  return { hours: account.hhHours !== '0' };
};

export const actions: Actions = {
  live: setLiveAdmin,
  restart: restartAdmin,
  hours: setHoursAdmin,
};

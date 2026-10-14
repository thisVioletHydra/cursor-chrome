import type { Actions, PageServerLoad } from './$types';

import { dropWaitingAdmin, restartAdmin, setHoursAdmin, setLiveAdmin } from '$lib/server/admin-actions';
import { SEARCH_HOURS_ENABLED } from '@cursor-chrome/hh';
import { readAccount } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview } = await parent();
  if (preview)
    return { hours: true, hoursShown: SEARCH_HOURS_ENABLED };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { hours: true, hoursShown: SEARCH_HOURS_ENABLED };

  const account = await readAccount(session.login);

  return { hours: account.hhHours !== '0', hoursShown: SEARCH_HOURS_ENABLED };
};

export const actions: Actions = {
  live: setLiveAdmin,
  restart: restartAdmin,
  hours: setHoursAdmin,
  dropWaiting: dropWaitingAdmin,
};

import type { Actions, PageServerLoad } from './$types';

import { importSetupAdmin } from '$lib/server/admin-actions';
import { accountFileStat } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

const when = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview } = await parent();
  if (preview)
    return { bytes: null, savedAt: '' };

  const session = readSession(cookies.get('session'));
  if (session === null)
    return { bytes: null, savedAt: '' };

  const stat = await accountFileStat(session.login);
  if (stat === null)
    return { bytes: null, savedAt: '' };

  return {
    bytes: stat.bytes,
    savedAt: when.format(stat.mtimeMs),
  };
};

export const actions: Actions = {
  import: importSetupAdmin,
};

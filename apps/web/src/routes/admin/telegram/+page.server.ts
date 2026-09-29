import type { Actions, PageServerLoad } from './$types';

import { connectOwner, ownerSaved } from '@cursor-chrome/telegram';
import { error, fail } from '@sveltejs/kit';
import { unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';
import { isCreator } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

export const load: PageServerLoad = async () => {
  return { owner: await ownerSaved() };
};

export const actions: Actions = {
  verify: verifyAdmin,
  unlink: unlinkAdmin,
  connect: async ({ cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || allowedLogins().includes(session.login) === false)
      error(401, 'нет');

    if (isCreator(session.login) && cookies.get('preview') === 'guest')
      return fail(403, { detail: 'это просмотр' });

    const result = await connectOwner();
    if (result.ok === false)
      return fail(422, { detail: result.detail });

    return { ok: true };
  },
};

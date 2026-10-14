import type { RequestHandler } from './$types';

import { extTokenResponse } from '$lib/server/ext-token';
import { isCreator, readAccount } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies }) =>
  extTokenResponse(request, name => cookies.get(name), {
    readSession,
    allowed: login => githubLogin(login) !== false,
    isCreator,
    tokenOf: async login => (await readAccount(login)).extToken ?? '',
  });

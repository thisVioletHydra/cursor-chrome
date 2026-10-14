import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { githubLogin, readSession } from '$lib/server/session';
import { testXaiKey } from '$lib/server/thin/byok-check';

// Key wizard: test an xAI key passed in x-llm-key (extension: Bearer extToken; admin: session cookie).
// The key is not logged, stored or returned.
export const POST: RequestHandler = async ({ request, cookies }) => {
  const session = readSession(cookies.get('session'));
  const who = (await extLogin(request)) ?? (session !== null && githubLogin(session.login) ? session.login : null);
  if (who === null)
    return json({ error: 'нет' }, { status: 401 });

  const result = await testXaiKey(request.headers.get('x-llm-key') ?? '');

  return json(result, { headers: { 'cache-control': 'no-store' } });
};

import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';

// Extension link check: 200 only for a valid Bearer extToken. No user data in the body.
export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request).catch(() => null);

  return new Response(JSON.stringify({ ok: login !== null }), { status: login === null ? 401 : 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

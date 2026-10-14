import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';

// Extension link check: 200 only for a valid Bearer extToken. Body: only the token owner's login (to bind local history).
export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request).catch(() => null);

  return new Response(JSON.stringify(login === null ? { ok: false } : { ok: true, login }), { status: login === null ? 401 : 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

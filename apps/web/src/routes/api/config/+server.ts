import type { RequestHandler } from './$types';

import { configBody } from '$lib/server/thin/config';

// Public config for the thin extension (no user data). ETag → 304.
export const GET: RequestHandler = async ({ request }) => {
  const { text, etag } = configBody();
  const headers = { etag, 'cache-control': 'no-cache', 'content-type': 'application/json' };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });

  return new Response(text, { headers });
};

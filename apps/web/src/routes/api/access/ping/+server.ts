import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { accessStore, safeLogLine } from '$lib/server/access';

// Cheap per-request gate: valid 4-hour pass + daily limit.
export const GET: RequestHandler = async ({ request }) => {
  const result = accessStore().usePass(request.headers.get('x-access-pass') ?? '');
  console.info(safeLogLine('GET', '/api/access/ping', result.status));

  return json(result, { status: result.status, headers: { 'cache-control': 'no-store' } });
};

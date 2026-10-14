import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { accessStore, safeLogLine, sha256 } from '$lib/server/access';

// Full device check (browser start / every 4 h): Bearer access token + signal hashes → 4-hour pass.
export const POST: RequestHandler = async ({ request }) => {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const body = await request.json().catch(() => null) as { signals?: unknown } | null;
  const result = accessStore().checkIn(token, body?.signals);
  console.info(safeLogLine('POST', '/api/access/check', result.status, token ? sha256(token) : ''));

  return json(result, { status: result.status, headers: { 'cache-control': 'no-store' } });
};

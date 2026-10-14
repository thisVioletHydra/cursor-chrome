import type { RequestHandler } from './$types';

import { listCanon, listMemory } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

// Read-only copy of the account's personal data for the extension's first-run import into chrome.storage.
// Whitelisted fields only: no tokens, no model chain, no keys. The server keeps the data as before.
export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const account = await readAccount(login) as unknown as Record<string, unknown>;
  const [rules, memory] = await Promise.all([listCanon().catch(() => []), listMemory().catch(() => [])]);

  return json({
    schema: 'cursor-chrome/local-data',
    version: 1,
    profile: account.profile ?? null,
    facts: account.facts ?? null,
    canonSeed: account.canonSeed ?? null,
    ...(rules.length > 0 ? { rules } : {}),
    memory,
    coverLetter: typeof account.coverLetter === 'string' ? account.coverLetter : '',
  }, { headers: { 'cache-control': 'no-store' } });
};

import type { RequestHandler } from './$types';

import { runTenant, storePath } from '@cursor-chrome/hh';
import { backupResponse } from '$lib/server/backup-dl';
import { isCreator, readAccountText } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

// Owner → /data/hh.sqlite, others → /data/tenants/<login>/hh.sqlite (same rule as the hh store).
export const POST: RequestHandler = async ({ request, cookies }) =>
  backupResponse(request, name => cookies.get(name), {
    readSession,
    allowed: login => githubLogin(login),
    isCreator,
    accountText: readAccountText,
    dbFile: login => runTenant(login, () => storePath()),
  });

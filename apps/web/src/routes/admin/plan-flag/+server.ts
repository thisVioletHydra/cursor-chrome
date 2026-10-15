import type { RequestHandler } from './$types';

import process from 'node:process';
import { githubLogin, readSession } from '$lib/server/session';
import { handlePlanFlag } from '$lib/server/thin/plan-flag-api';
import { planFlags } from '$lib/server/thin/plan-wire';

// dev only: GET → state, POST {on?: boolean} → set/toggle for the session's own account
const run: RequestHandler = ({ request, cookies }) => handlePlanFlag(request, {
  env: process.env,
  flags: planFlags,
  sessionLogin: () => {
    const session = readSession(cookies.get('session'));
    return session !== null && githubLogin(session.login) ? session.login : null;
  },
  guest: () => cookies.get('preview') === 'guest',
});

export const GET = run;
export const POST = run;

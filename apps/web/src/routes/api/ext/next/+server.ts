import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';
import { handleNext } from '$lib/server/thin/ext-cmd-api';
import { planLink } from '$lib/server/thin/plan-wire';

export const GET: RequestHandler = ({ request }) => handleNext(request, extLogin, undefined, undefined, planLink);
// POST: same poll, body carries the transit context for the planner (see thin/plan-context.ts)
export const POST: RequestHandler = ({ request }) => handleNext(request, extLogin, undefined, undefined, planLink);

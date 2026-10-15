import type { RequestHandler } from './$types';

import { planFlags } from '$lib/server/thin/plan-wire';
import { extLogin } from '$lib/server/ext-auth';
import { handleConfig } from '$lib/server/thin/ext-cmd-api';
import { extSettings } from '$lib/server/thin/ext-settings';

export const GET: RequestHandler = ({ request }) => handleConfig(request, extLogin, login => ({...extSettings.get(login),serverPlanner:planFlags.enabled(login)}));

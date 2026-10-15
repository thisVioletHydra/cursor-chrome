import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';
import { handleConfig } from '$lib/server/thin/ext-cmd-api';
import { extSettings } from '$lib/server/thin/ext-settings';

export const GET: RequestHandler = ({ request }) => handleConfig(request, extLogin, login => extSettings.get(login));

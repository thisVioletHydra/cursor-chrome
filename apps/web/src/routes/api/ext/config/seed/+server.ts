import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';
import { handleSeed } from '$lib/server/thin/ext-cmd-api';
import { extSettings } from '$lib/server/thin/ext-settings';

export const POST: RequestHandler = ({ request }) => handleSeed(request, extLogin, (login, values) => extSettings.seed(login, values));

import type { RequestHandler } from './$types';

import { extLogin } from '$lib/server/ext-auth';
import { handleReport } from '$lib/server/thin/ext-cmd-api';

export const POST: RequestHandler = ({ request }) => handleReport(request, extLogin);

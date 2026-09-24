import type { RequestHandler } from './$types';

import { redirect } from '@sveltejs/kit';

export const POST: RequestHandler = ({ cookies }) => {
  cookies.delete('session', { path: '/' });
  redirect(303, '/');
};

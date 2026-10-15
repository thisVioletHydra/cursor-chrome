import type { Actions, PageServerLoad } from './$types';

import { planFlags } from '$lib/server/thin/plan-wire';
import { extSettingsAdmin, issueExtTokenAdmin } from '$lib/server/admin-actions';
import { extSettings } from '$lib/server/thin/ext-settings';
import { readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ url, parent, cookies }) => {
  // extToken itself is never in load data: the client fetches it via POST /admin/ext-token on click.
  const { hasExtToken, preview } = await parent();
  const session = preview ? null : readSession(cookies.get('session'));
  // null = not set in the admin yet: the extension keeps its local values
  const settings = session === null ? null : extSettings.get(session.login);
  return { origin: url.origin, hasExtToken, settings, serverPlanner: session ? planFlags.enabled(session.login) : false, scenarios: session ? planFlags.scenarios(session.login) : {} };
};

export const actions: Actions = {
  extToken: issueExtTokenAdmin,
  settings: extSettingsAdmin,
};

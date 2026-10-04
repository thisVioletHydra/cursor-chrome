import type { Handle } from '@sveltejs/kit';

import { bindWatch, runTenant, startWatch, tenantLogin } from '@cursor-chrome/hh';
import { notifyOwner, notifyToken, setApplyGate, startAutopilot, startTelegram } from '@cursor-chrome/telegram';
import { extLogin } from '$lib/server/ext-auth';
import { publishExtLink } from '$lib/server/ext-link';
import { applySavedSecrets, CREATOR, isCreator, readAccount, takeVacancy } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

publishExtLink();
await applySavedSecrets();
setApplyGate((item) => {
  const login = tenantLogin();

  return takeVacancy(login.length > 0 ? login : CREATOR, item);
});
startWatch(async (text) => {
  const login = tenantLogin();
  if (login.length === 0 || isCreator(login)) {
    await notifyOwner(text);

    return;
  }

  const account = await readAccount(login);
  await notifyToken(account.telegramToken, text);
});
startTelegram();
startAutopilot();

export const handle: Handle = async ({ event, resolve }) => {
  if (asset(event.url.pathname))
    return resolve(event);

  const bearer = event.request.headers.get('authorization') ?? '';
  const ext = bearer.startsWith('Bearer ') ? await extLogin(event.request) : null;
  const session = ext === null ? readSession(event.cookies.get('session')) : null;
  const who = ext ?? (session !== null && githubLogin(session.login) ? session.login : null);
  if (who === null)
    return resolve(event);

  return runTenant(who, async () => {
    const account = await readAccount(who);
    bindWatch(account.hhLive === '1', account.hhHours !== '0');

    return resolve(event);
  });
};

function asset(pathname: string): boolean {
  if (pathname.startsWith('/_app') || pathname.startsWith('/favicon'))
    return true;

  const leaf = pathname.split('/').pop() ?? '';

  return leaf.includes('.');
}

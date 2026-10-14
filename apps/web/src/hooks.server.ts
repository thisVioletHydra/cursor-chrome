import type { Handle } from '@sveltejs/kit';
import { json, redirect } from '@sveltejs/kit';

import { bindWatch, runTenant, startWatch, tenantLogin } from '@cursor-chrome/hh';
import { notifyOwner, notifyToken, setApplyGate, startAutopilot, startTelegram } from '@cursor-chrome/telegram';
import { dev } from '$app/environment';
import { accessStore, safeLogLine } from '$lib/server/access';
import { DEV_USER, devBypass, warnIgnoredBypass } from '$lib/server/dev-auth';
import { extLogin } from '$lib/server/ext-auth';
import { publishExtLink } from '$lib/server/ext-link';
import { applySavedSecrets, CREATOR, isCreator, readAccount, takeVacancy } from '$lib/server/secrets';
import { githubLogin, readSession, signSession } from '$lib/server/session';
import { extensionBuild } from '$lib/server/extension-build';
import { dlSecret, signDl } from '$lib/server/thin/dl';
import { policyOf, versionGate } from '$lib/server/thin/version';

import { healthz, isHealthz } from '$lib/server/healthz';
import { demoAllow, ensureDemoToken, isDemoLogin } from '$lib/server/demo';

import process from 'node:process';

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
try {
  ensureDemoToken(accessStore());
}
catch {
  // access DB unavailable: demo login simply stays off
}
startAutopilot();

export const handle: Handle = async ({ event, resolve }) => {
  // healthcheck: before auth/version gate/tenant, always 200 no-store
  if (isHealthz(event.url.pathname))
    return healthz();

  if (asset(event.url.pathname))
    return resolve(event);

  useDevSession(event);
  const bearer = event.request.headers.get('authorization') ?? '';
  const ext = bearer.startsWith('Bearer ') ? await extLogin(event.request) : null;
  const session = ext === null ? readSession(event.cookies.get('session')) : null;
  // Version policy: only the server decides. Below min → 426 (except /api/config and /dl/); below recommended → flag.
  const extVersion = event.url.pathname.startsWith('/api/') ? event.request.headers.get('x-ext-version') : null;
  const policy = extVersion === null ? null : policyOf(process.env, await extensionBuild());
  const version = policy === null ? { status: 200 as const, outdated: false } : versionGate(event.url.pathname, extVersion, policy);
  const decorate = async (response: Response): Promise<Response> => {
    if (policy === null || version.outdated === false)
      return response;

    const link = ext === null ? '' : await readAccount(ext).then(account => (account.extToken ? `/dl/${signDl(ext, account.extToken, dlSecret(process.env))}` : '')).catch(() => '');
    const out = new Response(response.body, response);
    out.headers.set('x-ext-outdated', '1');
    out.headers.set('x-ext-recommended', policy.recommended);
    out.headers.set('x-ext-min', policy.min);
    if (link)
      out.headers.set('x-ext-update-url', link);
    out.headers.set('access-control-expose-headers', 'x-ext-outdated, x-ext-recommended, x-ext-min, x-ext-update-url');

    return out;
  };
  if (version.status === 426) {
    console.info(safeLogLine(event.request.method, event.url.pathname, 426));

    return decorate(json({ error: 'расширение устарело', min: policy?.min ?? '' }, { status: 426 }));
  }
  if (ext === null && (event.url.pathname === '/admin' || event.url.pathname.startsWith('/admin/')) && (session === null || githubLogin(session.login) === false)) {
    event.cookies.delete('session', { path: '/' });
    redirect(303, '/?expired=1');
  }
  // Access gate for every extension endpoint (except the access check itself): 403 on revoked token / no slot / no pass.
  if (ext !== null && event.url.pathname.startsWith('/api/') && event.url.pathname.startsWith('/api/access/') === false) {
    let gate: { ok: boolean; status: number; reason: string };
    try {
      gate = accessStore().gate(ext, event.request.headers.get('x-access-pass') ?? '');
    }
    catch {
      // access DB unavailable: never lock out the owner (legacy extToken), refuse everyone else
      gate = isCreator(ext) ? { ok: true, status: 200, reason: 'access db down, owner legacy' } : { ok: false, status: 403, reason: 'проверка доступа недоступна' };
    }
    if (gate.ok === false) {
      console.info(safeLogLine(event.request.method, event.url.pathname, gate.status));

      return decorate(json({ error: gate.reason }, { status: gate.status }));
    }
  }
  const who = ext ?? (session !== null && githubLogin(session.login) ? session.login : null);
  if (who === null)
    return decorate(await resolve(event));

  // demo account: request limits (per minute / per day)
  if (isDemoLogin(who)) {
    const allow = demoAllow();
    if (allow.ok === false)
      return decorate(json({ error: allow.reason }, { status: 429 }));
  }

  return runTenant(who, async () => {
    const account = await readAccount(who);
    bindWatch(account.hhLive === '1', account.hhHours !== '0');

    return decorate(await resolve(event));
  });
};

// Puts a real signed session for DEV_USER on the request, so every existing session check works unchanged.
function useDevSession(event: Parameters<Handle>[0]['event']): void {
  const input = { flag: process.env.DEV_NO_AUTH, nodeEnv: process.env.NODE_ENV, railway: process.env.RAILWAY_ENVIRONMENT, devServer: dev, hostname: event.url.hostname };
  warnIgnoredBypass(input);
  if (devBypass(input) === false || readSession(event.cookies.get('session')) !== null)
    return;

  event.cookies.set('session', signSession(DEV_USER), { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
}

function asset(pathname: string): boolean {
  if (pathname.startsWith('/_app') || pathname.startsWith('/favicon'))
    return true;

  const leaf = pathname.split('/').pop() ?? '';

  return leaf.includes('.');
}

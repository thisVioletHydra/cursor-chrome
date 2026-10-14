import type { PageServerLoad } from './$types';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { buildLabel } from '$lib/server/build-info';
import { demoToken } from '$lib/server/demo';
import { githubLogin, readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ cookies, url }) => {
  const session = readSession(cookies.get('session'));
  const allowed = session !== null && githubLogin(session.login);
  const demo = dev && url.searchParams.get('demo') === '1';
  if (allowed && demo === false)
    redirect(303, '/admin');

  const build = await buildLabel();
  let demoVersion = '';
  if (demo) {
    const source = await readFile(new URL('../lib/LoginScene.svelte', import.meta.url), 'utf8');
    demoVersion = `${build} · UI ${createHash('sha256').update(source).digest('hex').slice(0, 7)}`;
  }

  return {
    blocked: url.searchParams.get('blocked') === '1',
    expired: url.searchParams.get('expired') === '1',
    tokenBad: url.searchParams.get('token') === 'bad',
    demo,
    demoVersion,
    build,
    // only a flag: the token value never leaves the server
    tokenLogin: demoToken() !== '',
  };
};

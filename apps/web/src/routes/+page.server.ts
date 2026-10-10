import type { PageServerLoad } from './$types';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { githubLogin, readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ cookies, url }) => {
  const session = readSession(cookies.get('session'));
  const allowed = session !== null && githubLogin(session.login);
  const demo = dev && url.searchParams.get('demo') === '1';
  if (allowed && demo === false)
    redirect(303, '/admin');

  let demoVersion = '';
  if (demo) {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const source = await readFile(new URL('../lib/LoginScene.svelte', import.meta.url), 'utf8');
    const revision = createHash('sha256').update(source).digest('hex').slice(0, 7);
    demoVersion = `${commit} · UI ${revision}`;
  }

  return { blocked: url.searchParams.get('blocked') === '1', expired: url.searchParams.get('expired') === '1', demo, demoVersion };
};

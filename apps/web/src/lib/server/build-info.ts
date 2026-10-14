// Version + short commit for the login header. Railway exposes RAILWAY_GIT_COMMIT_SHA at build and run time;
// BUILD_COMMIT is a manual override; locally we ask git once. Never throws.
import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { extensionBuild } from './extension-build.ts';
import { APP_VERSION } from './user-agent.ts';

let commit: string | null = null;

export function shortCommit(env: Record<string, string | undefined> = process.env, git: () => string = gitHead): string {
  const raw = (env.RAILWAY_GIT_COMMIT_SHA || env.BUILD_COMMIT || '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(raw))
    return raw.slice(0, 7).toLowerCase();

  try {
    const head = git().trim();
    return /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : '';
  }
  catch {
    return '';
  }
}

function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
}

export async function buildLabel(): Promise<string> {
  commit ??= shortCommit();
  const version = await extensionBuild();

  return [version ? `v${version}` : '', commit].filter(Boolean).join(' · ');
}

// Admin sidebar line: version + deployed commit (runtime RAILWAY_GIT_COMMIT_SHA), `dev` when not on Railway.
export function deployCommit(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.RAILWAY_GIT_COMMIT_SHA || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(raw) ? raw.slice(0, 7).toLowerCase() : 'dev';
}

export function deployLine(version: string, env: Record<string, string | undefined> = process.env): string {
  return [version ? `v${version}` : '', deployCommit(env)].filter(Boolean).join(' · ');
}

export function deployLabel(): string {
  // same source as the NoJobNoProblemBuddy/<version> User-Agent (root package.json)
  return deployLine(APP_VERSION);
}

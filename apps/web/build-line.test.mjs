import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { deployCommit, deployLine } from './src/lib/server/build-info.ts';

test('deploy line: v<версия> · <7 символов>, без переменной — dev', () => {
  assert.equal(deployCommit({ RAILWAY_GIT_COMMIT_SHA: '8F61FB7abcdef0123' }), '8f61fb7');
  assert.equal(deployCommit({}), 'dev');
  assert.equal(deployCommit({ RAILWAY_GIT_COMMIT_SHA: 'nope' }), 'dev');
  assert.equal(deployLine('0.5.127', { RAILWAY_GIT_COMMIT_SHA: '8f61fb7aaaa' }), 'v0.5.127 · 8f61fb7');
  assert.equal(deployLine('', {}), 'dev');
});

test('sidebar: строка версии и у обычного, и у демо', () => {
  const svelte = fs.readFileSync(new URL('./src/routes/admin/+layout.svelte', import.meta.url), 'utf8');
  assert.equal(svelte.match(/data-testid="build-line"/g)?.length, 2);
  const server = fs.readFileSync(new URL('./src/routes/admin/+layout.server.ts', import.meta.url), 'utf8');
  assert.match(server, /buildLine: deployLabel\(\)/);
});

test('dev commit: no Railway sha → build-time git short sha, no git → «dev»; Railway wins', () => {
  assert.equal(deployCommit({}, 'ABCDEF1234'), 'abcdef1');
  assert.equal(deployCommit({}, ''), 'dev');
  assert.equal(deployCommit({}, 'not-a-sha'), 'dev');
  assert.equal(deployCommit({ RAILWAY_GIT_COMMIT_SHA: '8f61fb7aaaa' }, 'abcdef1'), '8f61fb7');
});

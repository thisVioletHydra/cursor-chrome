import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DEMO_BAR_TEXT, isDemoSession } from './src/lib/server/demo.ts';

test('isDemoSession: only vasya-pupkin, never guest preview', () => {
  assert.equal(isDemoSession('vasya-pupkin'), true);
  for (const login of ['roman', 'Vasya-Pupkin', 'vasya-pupkin2', '', null, undefined])
    assert.equal(isDemoSession(login), false);
  assert.equal(isDemoSession('vasya-pupkin', true), false);
});

test('admin layout: demo bar rendered only under data.isDemo, fixed bottom, with padding', () => {
  const svelte = readFileSync(new URL('./src/routes/admin/+layout.svelte', import.meta.url), 'utf8');
  const block = svelte.match(/\{#if data\.isDemo\}([\s\S]*?)\{\/if\}/);
  assert.ok(block, 'bar must be inside {#if data.isDemo}');
  assert.ok(block[1].includes(DEMO_BAR_TEXT));
  assert.match(block[1], /fixed[^"]*bottom-0/);
  assert.equal(svelte.split(DEMO_BAR_TEXT).length, 2, 'text appears once, only in the guarded block');
  assert.match(svelte, /data\.isDemo \? 'pb-16/);
  const server = readFileSync(new URL('./src/routes/admin/+layout.server.ts', import.meta.url), 'utf8');
  assert.match(server, /isDemo: isDemoSession\(session\.login, preview\)/);
});

test('profile: «Аккаунт: <login>» only for demo session, login from session data', () => {
  const svelte = readFileSync(new URL('./src/routes/admin/profile/+page.svelte', import.meta.url), 'utf8');
  const block = svelte.match(/\{#if data\.isDemo === true\}([\s\S]*?)\{\/if\}/);
  assert.ok(block, 'line must be inside {#if data.isDemo === true}');
  assert.match(block[1], /Аккаунт: <span[^>]*>\{data\.login\}<\/span>/);
  assert.equal(svelte.split('Аккаунт:').length, 2, 'line appears once, only in the guarded block');
  assert.ok(!svelte.includes('vasya-pupkin'), 'login is not hardcoded');
  const server = readFileSync(new URL('./src/routes/admin/+layout.server.ts', import.meta.url), 'utf8');
  assert.match(server, /login: preview \? 'гость' : session\.login/);
});

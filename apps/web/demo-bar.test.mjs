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

test('admin layout: bottom demo bar removed (warning only in the sidebar), no pb-16, disclaimer kept', () => {
  const svelte = readFileSync(new URL('./src/routes/admin/+layout.svelte', import.meta.url), 'utf8');
  assert.ok(!svelte.includes(DEMO_BAR_TEXT));
  assert.doesNotMatch(svelte, /data-testid="demo-bar"/);
  assert.doesNotMatch(svelte, /pb-16/);
  assert.match(svelte, /data-testid="disclaimer"/);
  assert.match(svelte, /\{#if data\.isDemo === true\}[\s\S]*?>Временно</);
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

test('sidebar demo block: «Временно», diagonal red line, no truncate/ellipsis, name not hardcoded', () => {
  const svelte = readFileSync(new URL('./src/routes/admin/+layout.svelte', import.meta.url), 'utf8');
  const m = svelte.match(/\{#if data\.isDemo === true\}([\s\S]*?)\{:else\}([\s\S]*?)\{\/if\}/);
  assert.ok(m);
  const demo = m[1];
  assert.match(demo, /text-red-400[^>]*>Временно</);
  assert.doesNotMatch(demo, /truncate|ellipsis|text-overflow|line-through|…/);
  assert.match(demo, /\{data\.demoName\}/);
  assert.match(demo, /<line x1="0" y1="100" x2="100" y2="0"/, 'diagonal, not horizontal');
  assert.match(demo, /text-red-500/);
  assert.ok(!svelte.includes('vasya') && !svelte.includes('Vasya') && !svelte.includes('Вася'), 'name not hardcoded');
  assert.match(m[2], /<span class="min-w-0 flex-1 truncate text-sm text-zinc-200">\{data\.login\}<\/span>/, 'regular branch unchanged');
  const server = readFileSync(new URL('./src/routes/admin/+layout.server.ts', import.meta.url), 'utf8');
  assert.match(server, /demoName: isDemoSession\(session\.login, preview\) \? shortDemoName\(DEMO_NAME, session\.login\) : ''/);
});

test('shortDemoName: deterministic, no ellipsis', async () => {
  const { shortDemoName } = await import('./src/lib/demo-name.ts');
  assert.equal(shortDemoName('Vasya Pupkin'), 'Vasya Pup');
  assert.equal(shortDemoName('Вася Пупкин'), 'Вася Пуп');
  assert.equal(shortDemoName('Vasya'), 'Vasya');
  assert.equal(shortDemoName('  Ivan   Ivanov '), 'Ivan Iva');
  assert.equal(shortDemoName('', 'vasya-pupkin'), 'vasya pup');
  assert.equal(shortDemoName(null, 'demo'), 'demo');
  assert.equal(shortDemoName('Supercalifragilistic'), 'Supercalif');
  for (const n of ['Vasya Pupkin', 'Supercalifragilistic', 'A B'])
    assert.ok(!shortDemoName(n).includes('…'));
});

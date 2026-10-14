import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { legacyAdminPath } from './src/lib/server/legacy-path.ts';
import { DISCLAIMER } from './src/lib/disclaimer.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const TEXT = 'NoJobNoProblemBuddy — независимый инструмент и не связан с площадками вакансий и их владельцами, не одобрен и не спонсируется ими. Товарные знаки принадлежат их правообладателям.';

test('/admin/hh и /admin/hh/* → /admin/source/* с query', () => {
  const at = path => legacyAdminPath(new URL(path, 'https://x.test'));
  assert.equal(at('/admin/hh'), '/admin/source');
  assert.equal(at('/admin/hh?/save'), '/admin/source?/save');
  assert.equal(at('/admin/hh/a/b?x=1&y=2'), '/admin/source/a/b?x=1&y=2');
  assert.equal(at('/admin/hhx'), null);
  assert.equal(at('/admin/source'), null);
  assert.equal(at('/api/queue'), null);
});

test('hooks отдают 308 (метод и тело POST сохраняются) до проверки сессии', () => {
  const hooks = read('./src/hooks.server.ts');
  assert.match(hooks, /legacyAdminPath\(event\.url\)[\s\S]*?status: 308/);
  assert.ok(hooks.indexOf('legacyAdminPath(event.url)') < hooks.indexOf("startsWith('/admin/')"));
  assert.ok(existsSync(new URL('./src/routes/admin/source/+page.svelte', import.meta.url)));
  assert.equal(existsSync(new URL('./src/routes/admin/hh', import.meta.url)), false);
  assert.doesNotMatch(read('./src/routes/admin/+layout.svelte'), /'\/admin\/hh'/);
  assert.doesNotMatch(read('./src/routes/admin/+page.svelte'), /'\/admin\/hh'/);
});

test('дисклеймер дословно: админка, вход, настройки расширения', () => {
  assert.equal(DISCLAIMER, TEXT);
  assert.match(read('./src/routes/admin/+layout.svelte'), /\{DISCLAIMER\}/);
  assert.match(read('./src/lib/LoginScene.svelte'), /\{DISCLAIMER\}/);
  assert.ok(read('../extension/src/options.html').includes(TEXT));
  const manifest = JSON.parse(read('../extension/src/manifest.json'));
  assert.ok(manifest.description.length <= 132);
  assert.match(manifest.description, /not affiliated/);
});

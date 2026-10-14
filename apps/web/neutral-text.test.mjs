import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { neutralText } from './src/lib/neutral-text.ts';

const root = new URL('../../', import.meta.url).pathname;
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

// Убираем URL, пути, имена и ключи: остаётся видимый текст.
function visible(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/https?:\/\/[^\s"'`<>]+/g, '')
    .replace(/\b(?:href|class|id|name|value|for|action|data-[\w-]+)=("[^"]*"|\{[^}]*\})/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/[\w.-]*\/[\w./-]*/g, '')
    .replace(/\b\w*(?:hh|HH)\w+|\w+(?:hh|HH)\b/g, '');
}
const BAD = /HeadHunter|(?<![\w./-])hh(?![\w./-])/i;

function check(label, text) {
  const lines = visible(text).split('\n').filter(line => BAD.test(line));
  assert.deepEqual(lines, [], `${label}: видно hh/HeadHunter`);
}

test('svelte-шаблоны админки и вход без hh/HeadHunter', () => {
  const files = [...walk(join(root, 'apps/web/src/routes/admin')), join(root, 'apps/web/src/lib/LoginScene.svelte'), join(root, 'apps/web/src/lib/KeyConnect.svelte')]
    .filter(file => file.endsWith('.svelte'));
  for (const file of files)
    check(file, readFileSync(file, 'utf8'));
});

test('попап и описание расширения без hh/HeadHunter', () => {
  check('popup.html', readFileSync(join(root, 'apps/extension/src/popup.html'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'apps/extension/src/manifest.json'), 'utf8'));
  for (const key of ['name', 'short_name', 'description'])
    check(`manifest.${key}`, String(manifest[key] ?? '').replace(/https?:\/\/\S+/g, ''));
  check('action.default_title', String(manifest.action?.default_title ?? ''));
});

test('тексты Telegram и проверки без hh/HeadHunter', () => {
  const watch = readFileSync(join(root, 'apps/hh/src/watch/watch.ts'), 'utf8');
  const texts = [...watch.matchAll(/const CAPTCHA_\w+ = '([^']*)'/g)].map(match => match[1]);
  assert.ok(texts.length >= 2);
  for (const text of texts)
    check('watch.ts капча', text);
  const checks = readFileSync(join(root, 'apps/web/src/lib/server/checks.ts'), 'utf8');
  for (const match of checks.matchAll(/name: '([^']*)'/g))
    check('checks.ts name', match[1]);
});

test('старые причины из БД показываются по-новому', () => {
  assert.equal(neutralText('свои вопросы HH'), 'свои вопросы площадки');
  assert.equal(neutralText('лимит откликов hh: 200'), 'лимит откликов площадки: 200');
  assert.equal(neutralText(null), '');
  assert.equal(neutralText('уже видели'), 'уже видели');
});

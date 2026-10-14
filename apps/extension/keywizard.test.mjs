import { coachSteps, coachView, COACH_STEPS, FALLBACK_TEXT, locate, paint } from './src/local/coach.ts';
import { BUILTIN } from './src/local/config-cache.ts';
import { maskKey, readClipboardKey, testKey, validXaiKey, XAI_KEYS_URL } from './src/local/key-wizard.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const KEY = `xai-${'Fake0Key1Test2'.repeat(5)}`;

test('wizard: console URL, format, mask, clipboard on click', async () => {
  assert.equal(XAI_KEYS_URL, 'https://console.x.ai/team/default/api-keys');
  assert.equal(validXaiKey(KEY), true);
  assert.equal(validXaiKey('xai-123'), false);
  const masked = maskKey(KEY);
  assert.equal(masked.startsWith('xai-'), true);
  assert.equal(masked.includes(KEY.slice(4, -4)), false);
  assert.deepEqual(await readClipboardKey({ readText: async () => `  ${KEY} ` }), { key: KEY, error: '' });
  assert.match((await readClipboardKey({ readText: async () => 'hello' })).error, /не ключ xAI/);
  assert.match((await readClipboardKey({ readText: async () => '' })).error, /пуст/);
  assert.match((await readClipboardKey({ readText: async () => { throw new Error('denied'); } })).error, /нет доступа/);
});

test('wizard: test goes through our server, key only in x-llm-key; coach is not an optional permission', async () => {
  let sent;
  const ok = await testKey('http://s', 'ext_k', KEY, async (url, init) => { sent = { url, init }; return new Response('{"ok":true,"code":"ok","message":"✅ ключ работает"}'); });
  assert.deepEqual([ok.ok, ok.message], [true, '✅ ключ работает']);
  assert.equal(sent.url, 'http://s/api/byok/test');
  assert.equal(sent.init.headers['x-llm-key'], KEY);
  assert.equal(sent.init.body, undefined);
  assert.equal((await testKey('http://s', 'k', KEY, async () => new Response('{"ok":false,"code":"bad-key","message":"неверный ключ"}'))).message, 'неверный ключ');
  assert.equal((await testKey('http://s', 'k', KEY, async () => { throw new Error('x'); })).message, 'нет связи');
  assert.equal((await testKey('http://s', 'k', 'bad', async () => { throw new Error('must not call'); })).code, 'bad-format');
  const manifest = JSON.parse(fs.readFileSync(new URL('./src/manifest.json', import.meta.url), 'utf8'));
  const required = new Set(manifest.host_permissions ?? []);
  const optional = manifest.optional_host_permissions ?? [];
  // Chrome warns "Optional permission ... is redundant" when optional overlaps required (<all_urls> covers everything)
  assert.deepEqual(optional.filter(o => required.has(o) || required.has('<all_urls>')), [], 'no optional/required overlap');
  assert.deepEqual((manifest.optional_permissions ?? []).filter(o => (manifest.permissions ?? []).includes(o)), []);
  assert.equal(fs.readFileSync(new URL('./src/options/options.ts', import.meta.url), 'utf8').includes('permissions.request'), false, 'no prompt for coach');
  assert.equal(JSON.stringify(manifest.content_scripts).includes('console.x.ai'), false, 'coach is registered at runtime only');
});

// Element proxy: only getBoundingClientRect is allowed; any other property read is recorded.
function spyElement(rect, touched) {
  return new Proxy({}, { get: (_t, prop) => { if (prop === 'getBoundingClientRect') return () => rect; touched.push(String(prop)); return undefined; } });
}

test('coach: ring around the furthest step, no DOM reads beyond selector + rect', () => {
  const touched = [];
  const asked = [];
  const doc = { querySelector: (sel) => { asked.push(sel); return sel === BUILTIN.selectors.xaiCreateKey ? spyElement({ top: 100, left: 200, width: 160, height: 40 }, touched) : null; } };
  const steps = coachSteps(BUILTIN.selectors);
  const view = coachView(locate(doc, steps), steps);
  assert.equal(view.mode, 'ring');
  assert.equal(view.index, 3);
  assert.match(view.text, /Нажми сюда: Create API key/);
  assert.deepEqual(view.ring, { top: 92, left: 192, width: 176, height: 56 });
  assert.deepEqual(touched, [], 'no textContent / value / innerText / attributes read');
  assert.deepEqual(asked, [BUILTIN.selectors.xaiCopyKey, BUILTIN.selectors.xaiCreateKey]);
  const root = { innerHTML: '' };
  paint(root, view);
  assert.match(root.innerHTML, /class="ring"/);
  assert.match(root.innerHTML, /шаг 3 из 4/);
  assert.equal(COACH_STEPS.length, 4);
});

test('coach: element not found, broken selector or zero size → text hint', () => {
  const steps = coachSteps({ ...BUILTIN.selectors, xaiLogin: '[[broken' });
  const none = { querySelector: (sel) => { if (sel === '[[broken') throw new SyntaxError('bad'); return null; } };
  const view = coachView(locate(none, steps), steps);
  assert.deepEqual(view, { mode: 'text', text: FALLBACK_TEXT });
  const hidden = { querySelector: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }) }) };
  assert.equal(coachView(locate(hidden, steps), steps).mode, 'text');
  const root = { innerHTML: '' };
  paint(root, view);
  assert.match(root.innerHTML, /class="tip banner"/);
  assert.match(root.innerHTML, /вернись в расширение/);
  const source = fs.readFileSync(new URL('./src/local/coach.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('./src/coach.ts', import.meta.url), 'utf8');
  assert.equal(/\.click\(|\.value\b|textContent|innerText|getAttribute|clipboard|dispatchEvent/.test(source.replace(/\/\/.*$/gm, '')), false, 'no clicks, no reading page values');
});

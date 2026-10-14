import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { healthz, isHealthz } from './src/lib/server/healthz.ts';
import { installUpdatingWatch, isApiUrl } from './src/lib/updating.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('/healthz: 200, no-store, skipped in hooks before auth/tenant', async () => {
  const res = healthz();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), 'ok');
  assert.equal(isHealthz('/healthz'), true);
  assert.equal(isHealthz('/healthz/x'), false);
  const hooks = read('./src/hooks.server.ts');
  const handle = hooks.slice(hooks.indexOf('export const handle'));
  assert.ok(handle.indexOf('isHealthz(event.url.pathname)') < handle.indexOf('useDevSession'), 'healthz first');
  assert.match(read('./src/routes/healthz/+server.ts'), /export const GET/);
  for (const file of ['./railway.toml', '../../railway.toml']) {
    const toml = read(file);
    assert.match(toml, /healthcheckPath = "\/healthz"/);
    assert.match(toml, /healthcheckTimeout = \d+/);
    assert.match(toml, /buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @cursor-chrome\/extension build && pnpm --filter @cursor-chrome\/web build"/);
  }
});

test('updating.html: self-contained, right texts, no error code, pings /healthz every 3 s', () => {
  const html = read('./static/updating.html');
  for (const text of ['Обновляемся', 'Вернёмся через минутку, страница обновится сама', 'Попробовать снова'])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:)?\/\//i, 'no external links');
  assert.doesNotMatch(html, /@import|url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /<link\b|<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /\b(404|500|502|503|504)\b/);
  assert.match(html, /fetch\('\/healthz'/);
  assert.match(html, /setInterval\(ping, 3000\)/);
  assert.match(html, /location\.reload\(\)/);
  assert.match(html, /<svg[\s\S]*class="plug"/);
});

async function loadSw(network) {
  const handlers = {};
  const store = new Map();
  const cache = { add: async (req) => { store.set(new URL(req.url ?? req, 'https://x.test').pathname, new Response('UPDATING', { status: 200 })); }, put: async (req) => { store.set(String(req), 'PUT'); } };
  globalThis.self = { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin: 'https://x.test' }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  globalThis.caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async path => (store.has(path) ? new Response("UPDATING") : undefined) };
  globalThis.fetch = network;
  await import(`./src/service-worker.ts?${Math.random()}`);
  let wait;
  handlers.install({ waitUntil: (p) => { wait = p; } });
  await wait;
  const run = async (url, mode = 'navigate', method = 'GET') => {
    let answered = null;
    handlers.fetch({ request: { url, mode, method }, respondWith: (p) => { answered = p; } });
    return answered === null ? null : await answered;
  };

  return { run, store };
}

test('SW: only updating.html cached; /api and admin HTML pass through; 503/network → updating.html', async () => {
  let status = 200;
  let fail = false;
  const sw = await loadSw(async () => { if (fail) throw new TypeError('net'); return new Response('ADMIN', { status }); });
  assert.deepEqual([...sw.store.keys()], ['/updating.html']);
  assert.equal(await sw.run('https://x.test/api/queue', 'cors'), null);
  assert.equal(await sw.run('https://x.test/api/queue', 'navigate'), null);
  assert.equal(await (await sw.run('https://x.test/admin')).text(), 'ADMIN');
  status = 503;
  assert.equal(await (await sw.run('https://x.test/admin')).text(), 'UPDATING');
  status = 502;
  assert.equal(await (await sw.run('https://x.test/admin/memory')).text(), 'UPDATING');
  fail = true;
  assert.equal(await (await sw.run('https://x.test/admin')).text(), 'UPDATING');
  assert.deepEqual([...sw.store.keys()], ['/updating.html'], 'admin HTML never cached');
  const src = read('./src/service-worker.ts');
  assert.doesNotMatch(src, /cache\.put|\.put\(/);
  assert.match(src, /TIMEOUT_MS = 8000/);
});

test('admin overlay: shown on /api network error or 502/503/504, hidden on healthy message', async () => {
  assert.equal(isApiUrl('/api/x', 'https://x.test'), true);
  assert.equal(isApiUrl('https://other.test/api/x', 'https://x.test'), false);
  let status = 503;
  const listeners = {};
  const win = { location: { origin: 'https://x.test' }, fetch: async () => { if (status === 0) throw new TypeError('net'); return new Response('', { status }); }, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: () => {} };
  const seen = [];
  installUpdatingWatch(win, on => seen.push(on));
  await win.fetch('/api/a');
  status = 200;
  await win.fetch('/api/a');
  status = 500;
  await win.fetch('/api/a');
  status = 503;
  await win.fetch('/other');
  status = 0;
  await assert.rejects(win.fetch('/api/b'));
  listeners.message({ origin: 'https://x.test', data: { type: 'nojob-healthy' } });
  listeners.message({ origin: 'https://evil.test', data: { type: 'nojob-healthy' } });
  assert.deepEqual(seen, [true, true, false]);
  const svelte = read('./src/routes/admin/+layout.svelte');
  assert.match(svelte, /\{#if updating\}[\s\S]*src="\/updating\.html"/);
});

test('sidebar: demo → red «Временный демо-аккаунт», no GitHub icon/login; regular → as before', () => {
  const svelte = read('./src/routes/admin/+layout.svelte');
  const m = svelte.match(/\{#if data\.isDemo === true\}([\s\S]*?)\{:else\}([\s\S]*?)\{\/if\}/);
  assert.ok(m);
  assert.match(m[1], /text-red-400[^>]*>Временный демо-аккаунт</);
  assert.doesNotMatch(m[1], /<svg|data\.login/);
  assert.match(m[2], /<svg class="size-5 shrink-0" viewBox="0 0 16 16"/);
  assert.match(m[2], /\{data\.login\}/);
  assert.equal(svelte.split('{data.login}').length, 2, 'login only in the regular branch');
});

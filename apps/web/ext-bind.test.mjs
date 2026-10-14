import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { extBindState, fetchConnectLink, readMark } from './src/lib/ext-bind.ts';

test('ext-bind: missing / unlinked / linked / stale', () => {
  assert.equal(extBindState('', 'never'), 'missing');
  assert.equal(extBindState('unlinked', 'never'), 'unlinked');
  assert.equal(extBindState('unlinked', 'stale'), 'unlinked');
  assert.equal(extBindState('linked', 'never'), 'linked');
  assert.equal(extBindState('', 'ok'), 'linked');
  assert.equal(extBindState('', 'stale'), 'stale');
  assert.equal(readMark('x'), '');
});

test('ext-bind: key fetched by POST on click, not in HTML', async () => {
  const seen = [];
  const link = await fetchConnectLink('https://o.example', async (url, init) => { seen.push([url, init.method]); return new Response('{"token":"abc"}', { status: 200 }); });
  assert.equal(link, 'https://o.example/connect#abc');
  assert.deepEqual(seen, [['/admin/ext-token', 'POST']]);
  assert.equal(await fetchConnectLink('https://o', async () => new Response('', { status: 401 })), '');
  const page = fs.readFileSync(new URL('./src/routes/admin/+page.svelte', import.meta.url), 'utf8');
  assert.match(page, /name="nojob-admin"/);
  assert.match(page, /Свяжи расширение: вставь этот ключ в расширение/);
  assert.doesNotMatch(page, /data\.extToken/);
});

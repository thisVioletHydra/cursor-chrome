import assert from 'node:assert/strict';
import test from 'node:test';

import { syncExtConfig } from './src/pilot/ext-config-sync.ts';
import { adminSettingsOf, localPatch, managedBy, mergeSettings } from './src/pilot/ext-settings.ts';

const LOCAL = { hideJunk: true, keepSession: false, showPop: true, showMachine: false, autoQueue: true };

test('merge: admin wins per key, missing admin → local; autoQueue never managed; local patch drops managed keys', () => {
  assert.deepEqual(mergeSettings(LOCAL, null), LOCAL);
  const admin = { hideJunk: false, showMachine: true, autoQueue: false };
  const m = mergeSettings(LOCAL, adminSettingsOf({ 'extConfig:v1': { settings: admin } }));
  assert.deepEqual(m, { ...LOCAL, hideJunk: false, showMachine: true });
  assert.deepEqual(managedBy({ hideJunk: false }), ['hideJunk']);
  assert.deepEqual(localPatch({ hideJunk: true, autoQueue: false }, { hideJunk: false }), { autoQueue: false });
});

function box(initial = {}) {
  const store = { ...initial };
  return { store, get: async keys => Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]])), set: async items => { Object.assign(store, items); } };
}
const base = { base: async () => 'https://x.test', key: async () => 'k', gateOpen: async () => true };

test('sync: caches with etag, sends If-None-Match, 304 keeps cache; closed gate → no request', async () => {
  const b = box({ flags: LOCAL, 'extSettingsSeed:v1': true });
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push(init.headers['if-none-match'] ?? '');
    return seen.length === 1 ? new Response(JSON.stringify({ settings: { showPop: false } }), { status: 200, headers: { etag: '"e1"' } }) : new Response(null, { status: 304 });
  };
  assert.equal(await syncExtConfig({ ...base, ...b, fetcher }), 'fresh');
  assert.equal(await syncExtConfig({ ...base, ...b, fetcher }), 'same');
  assert.deepEqual(seen, ['', '"e1"']);
  assert.deepEqual(b.store['extConfig:v1'].settings, { showPop: false });
  assert.deepEqual(b.store.flags, LOCAL, 'local values untouched');
  let calls = 0;
  assert.equal(await syncExtConfig({ ...base, ...b, gateOpen: async () => false, fetcher: async () => { calls += 1; } }), 'closed');
  assert.equal(calls, 0);
});

test('sync: admin empty → seeds local managed values once (no autoQueue, no keys), local kept', async () => {
  const b = box({ flags: LOCAL, 'byok:v1': { key: 'secret' } });
  const posts = [];
  let admin = null;
  const fetcher = async (url, init) => {
    if (url.endsWith('/seed')) {
      posts.push(JSON.parse(init.body));
      admin = posts[0];
      return new Response('{"ok":true}', { status: 200 });
    }
    return new Response(JSON.stringify({ settings: admin }), { status: 200, headers: { etag: admin ? '"e2"' : '"e0"' } });
  };
  assert.equal(await syncExtConfig({ ...base, ...b, fetcher }), 'seeded');
  assert.deepEqual(posts, [{ hideJunk: true, keepSession: false, showPop: true, showMachine: false }]);
  assert.equal(JSON.stringify(posts).includes('secret'), false);
  assert.equal(b.store['extSettingsSeed:v1'], true);
  assert.deepEqual(b.store.flags, LOCAL);
  admin = null;
  assert.equal(await syncExtConfig({ ...base, ...b, fetcher }), 'fresh', 'seed marker → no second seed');
  assert.equal(posts.length, 1);
});

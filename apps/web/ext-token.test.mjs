import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { extTokenResponse } from './src/lib/server/ext-token.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const FAKE = 'fake-token-not-real';
const deps = {
  readSession: raw => (raw === 'ok' ? { login: 'someone' } : raw === 'creator' ? { login: 'boss' } : null),
  allowed: () => true,
  isCreator: login => login === 'boss',
  tokenOf: async () => FAKE,
};
const req = (origin = 'https://app.test', method = 'POST') => new Request('https://app.test/admin/ext-token', { method, headers: origin ? { origin } : {} });
const jar = obj => name => obj[name];

test('load data: admin layout, extension page and /start never return extToken', () => {
  const layout = read('./src/routes/admin/+layout.server.ts');
  assert.doesNotMatch(layout, /^\s*extToken\s*:/m);
  assert.doesNotMatch(layout, /extToken: (preview \? '' : )?account\.extToken/);
  const ext = read('./src/routes/admin/extension/+page.server.ts');
  assert.doesNotMatch(ext, /account\.extToken|extToken:(?! issueExtTokenAdmin)/);
  const start = read('./src/routes/start/+page.server.ts');
  assert.doesNotMatch(start, /connect#|connectUrl/);
  assert.doesNotMatch(read('./src/routes/admin/extension/+page.svelte'), /data\.extToken/);
  assert.match(read('./src/routes/admin/extension/+page.svelte'), /fetch\('\/admin\/ext-token', \{ method: 'POST'/);
});

test('endpoint: no session → 401, no-store', async () => {
  const res = await extTokenResponse(req(), jar({}), deps);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!(await res.text()).includes(FAKE));
});

test('endpoint: foreign or missing Origin → 403, GET → 405', async () => {
  for (const origin of ['https://evil.test', ''])
    assert.equal((await extTokenResponse(req(origin), jar({ session: 'ok' }), deps)).status, 403);
  assert.equal((await extTokenResponse(req('https://app.test', 'GET'), jar({ session: 'ok' }), deps)).status, 405);
});

test('endpoint: guest preview → 403', async () => {
  assert.equal((await extTokenResponse(req(), jar({ session: 'creator', preview: 'guest' }), deps)).status, 403);
});

test('endpoint: session + same origin → token, no-store, read-only', async () => {
  let writes = 0;
  const res = await extTokenResponse(req(), jar({ session: 'ok' }), { ...deps, tokenOf: async () => { writes += 0; return FAKE; } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { token: FAKE });
  assert.doesNotMatch(read('./src/routes/admin/ext-token/+server.ts'), /writeAccount|newExtToken|ensureAccount/);
});

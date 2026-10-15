import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleConfig, handleSeed } from './src/lib/server/thin/ext-cmd-api.ts';
import { createExtSettings } from './src/lib/server/thin/ext-settings.ts';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'extset-')), 'ext-settings.sqlite');
const req = (init = {}) => new Request('https://x.test/api/ext/config', { ...init, headers: { authorization: 'Bearer t', ...(init.headers ?? {}) } });

test('store: empty → null, reads never create the file, only managed booleans kept', () => {
  const file = tmp();
  const s = createExtSettings(file);
  assert.equal(s.get('roman'), null);
  assert.equal(fs.existsSync(file), false);
  s.set('roman', { hideJunk: true, llmKey: 'sk-x', showPop: 'yes' });
  assert.deepEqual(s.get('roman'), { hideJunk: true });
  assert.equal(s.get('vasya-pupkin'), null, 'other account untouched');
  assert.throws(() => s.set('../x', {}));
  s.close();
});

test('seed: only when admin is empty, never overwrites admin values', () => {
  const s = createExtSettings(tmp());
  assert.equal(s.seed('roman', { hideJunk: true, showMachine: true }), true);
  assert.equal(s.seed('roman', { hideJunk: false }), false);
  assert.deepEqual(s.get('roman'), { hideJunk: true, showMachine: true });
  assert.equal(s.seed('vasya-pupkin', {}), false, 'nothing to seed → nothing written');
  s.close();
});

test('/api/ext/config: settings in body, ETag changes with them, 304 on same; seed endpoint; 401', async () => {
  const s = createExtSettings(tmp());
  const loginOf = async r => r.headers.get('authorization') === 'Bearer t' ? 'roman' : null;
  const a = await handleConfig(req(), loginOf, l => s.get(l));
  const body = await a.json();
  assert.equal(body.settings, null);
  assert.ok(body.selectors, 'old config still there');
  const etag = a.headers.get('etag');
  assert.equal((await handleConfig(req({ headers: { 'if-none-match': etag } }), loginOf, l => s.get(l))).status, 304);
  const seeded = await handleSeed(req({ method: 'POST', body: JSON.stringify({ showPop: false }) }), loginOf, (l, v) => s.seed(l, v));
  assert.deepEqual(await seeded.json(), { ok: true, seeded: true });
  const b = await handleConfig(req({ headers: { 'if-none-match': etag } }), loginOf, l => s.get(l));
  assert.equal(b.status, 200);
  assert.deepEqual((await b.json()).settings, { showPop: false });
  assert.equal((await handleConfig(new Request('https://x.test/api/ext/config'), loginOf, l => s.get(l))).status, 401);
  s.close();
});

// DEMO_TOKEN_LOGIN: token login opens vasya-pupkin only — never Roman, never anyone else.
import { openAccess, sha256 } from './src/lib/server/access.ts';
import { DEMO_LOGIN, demoAllow, demoLoginFor, demoToken, ensureDemoToken, resetDemoLimits, serverChainFor } from './src/lib/server/demo.ts';
import { pickLlm } from './src/lib/server/thin/answer-api.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const TOKEN = 'demo_Vasya_Fake_Token_1234567890';
const ON = { DEMO_TOKEN_LOGIN: '1', DEMO_LOGIN_TOKEN: TOKEN };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-access-')), 'access.sqlite');

test('flag + env token required; RAILWAY_ENVIRONMENT no longer matters', () => {
  assert.equal(demoToken(ON), TOKEN);
  assert.equal(demoToken({ ...ON, RAILWAY_ENVIRONMENT: 'production' }), TOKEN);
  assert.equal(demoToken({ DEMO_LOGIN_TOKEN: TOKEN }), '');
  assert.equal(demoToken({ DEMO_TOKEN_LOGIN: '1' }), '');
  assert.equal(demoToken({ DEMO_TOKEN_LOGIN: '1', DEMO_LOGIN_TOKEN: 'short' }), '');
});

test('the shown token opens vasya-pupkin; only its hash lands in the access DB', () => {
  const file = tmpFile();
  const store = openAccess(file);
  assert.equal(demoLoginFor(store, TOKEN, ON), DEMO_LOGIN);
  assert.equal(store.loginOf(TOKEN), DEMO_LOGIN);
  const row = store.db.prepare('SELECT hash, login FROM access_token').all();
  assert.deepEqual(row.map(r => [r.hash, r.login]), [[sha256(TOKEN), DEMO_LOGIN]]);
  store.db.close();
  assert.equal(fs.readFileSync(file).includes(TOKEN), false, 'raw token never stored');
});

test('token login never lets in Roman or any other account', () => {
  const store = openAccess(tmpFile());
  const roman = store.issue('Роман', 'thisVioletHydra');
  const other = store.issue('Петя', 'petya-ivanov');
  assert.equal(demoLoginFor(store, roman, ON), null, 'Roman token via demo form');
  assert.equal(demoLoginFor(store, other, ON), null, 'another account token');
  assert.equal(demoLoginFor(store, roman, { DEMO_TOKEN_LOGIN: '1', DEMO_LOGIN_TOKEN: roman }), null, 'env pointed at Roman token: never rebinds');
  assert.equal(store.loginOf(roman), 'thisVioletHydra');
  assert.equal(demoLoginFor(store, other, { DEMO_TOKEN_LOGIN: '1', DEMO_LOGIN_TOKEN: other }), null);
  assert.equal(demoLoginFor(store, 'wrong-token-but-long-enough', ON), null);
  assert.equal(demoLoginFor(store, '', ON), null);
  assert.equal(demoLoginFor(store, TOKEN, { DEMO_LOGIN_TOKEN: TOKEN }), null, 'flag off');
  assert.equal(demoLoginFor(store, TOKEN, ON), DEMO_LOGIN);
  store.revoke(TOKEN);
  assert.equal(demoLoginFor(store, TOKEN, ON), null, 'revoked demo token');
});

test('a demo hash bound to someone else stays theirs', () => {
  const store = openAccess(tmpFile());
  store.adopt(TOKEN, 'x', 'thisVioletHydra');
  assert.equal(ensureDemoToken(store, ON), false);
  assert.equal(demoLoginFor(store, TOKEN, ON), null);
});

test('demo limits: per minute and per day', () => {
  resetDemoLimits();
  const t = Date.UTC(2026, 9, 14, 10);
  for (let i = 0; i < 3; i++)
    assert.equal(demoAllow(t + i, 3, 5).ok, true);
  assert.match(demoAllow(t + 10, 3, 5).reason, /в минуту/);
  assert.equal(demoAllow(t + 61_000, 3, 5).ok, true);
  assert.equal(demoAllow(t + 61_001, 3, 5).ok, true);
  assert.match(demoAllow(t + 125_000, 3, 5).reason, /в день/);
  assert.equal(demoAllow(t + 86_400_000, 3, 5).ok, true, 'new day');
  resetDemoLimits();
});

test('demo account never spends our LLM key: BYOK only', () => {
  const ours = [{ id: 'groq', key: 'server-key', model: 'm', url: 'u' }];
  assert.deepEqual(serverChainFor(DEMO_LOGIN, ours), []);
  assert.deepEqual(serverChainFor('thisVioletHydra', ours), ours);
  const deps = { complete: async () => 'byok', askChain: async () => 'ours' };
  assert.equal(pickLlm(new Headers(), serverChainFor(DEMO_LOGIN, ours), deps).mode, 'none');
  assert.equal(pickLlm(new Headers({ 'x-llm-key': `xai-${'a'.repeat(30)}`, 'x-llm-provider': 'xai' }), serverChainFor(DEMO_LOGIN, ours), deps).mode, 'byok');
  const answer = fs.readFileSync(new URL('./src/routes/api/answer/+server.ts', import.meta.url), 'utf8');
  assert.match(answer, /serverChainFor\(login, chainFromEnv\(\)\)/);
});

test('login route: POST form only, no Railway block, no other login source', () => {
  const route = fs.readFileSync(new URL('./src/routes/auth/demo/+server.ts', import.meta.url), 'utf8');
  assert.equal(/RAILWAY_ENVIRONMENT/.test(route), false);
  assert.equal(/export const GET/.test(route), false);
  assert.match(route, /demoLoginFor\(accessStore\(\)/);
  assert.equal(/searchParams\.get\('token'\)/.test(route), false, 'token never in the URL');
});

test('token value never reaches the page: the loader returns only a flag', () => {
  const page = fs.readFileSync(new URL('./src/routes/+page.server.ts', import.meta.url), 'utf8');
  const scene = fs.readFileSync(new URL('./src/lib/LoginScene.svelte', import.meta.url), 'utf8');
  assert.match(page, /tokenLogin: demoToken\(\) !== ''/);
  assert.equal(/token:\s*demoToken|demoToken\(\),/.test(page), false);
  assert.equal(/DEMO_LOGIN_TOKEN|demoToken/.test(scene), false);
  assert.match(scene, /type="password"/);
});

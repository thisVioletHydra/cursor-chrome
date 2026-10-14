// Key wizard → chain: only the logged-in login's chain changes (Vasya), Roman's chain and keys stay byte-identical.
import { addXaiToChain } from './src/lib/server/thin/byok-chain.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = `xai-${'Fake0Key1Test2'.repeat(5)}`;
const ROMAN = JSON.stringify([{ id: 'gemini', key: 'roman-fake-gemini-key', model: 'gemini-3.8-flash', url: 'https://g' }, { id: 'xai', key: 'xai-roman-fake-key-0000000000000000', model: 'grok-4.7', url: 'https://x' }]);

function memoryStore() {
  const rows = new Map([['thisVioletHydra', { modelChain: ROMAN, telegramToken: 'roman-fake-tg' }], ['vasya-pupkin', { modelChain: '' }]]);
  const writes = [];
  return {
    rows,
    writes,
    deps: test => ({
      read: async login => structuredClone(rows.get(login) ?? { modelChain: '' }),
      write: async (login, next) => { writes.push(login); rows.set(login, next); },
      test,
    }),
  };
}

test('Grok from the wizard lands in vasya-pupkin chain as xai + grok-4.7; Roman untouched', async () => {
  const store = memoryStore();
  const before = JSON.stringify(store.rows.get('thisVioletHydra'));
  const done = await addXaiToChain('vasya-pupkin', KEY, store.deps(async () => ({ ok: true, code: 'ok', message: '✅ ключ работает' })));
  assert.equal(done.ok, true);
  assert.deepEqual(store.writes, ['vasya-pupkin']);
  const chain = JSON.parse(store.rows.get('vasya-pupkin').modelChain);
  assert.deepEqual(chain.map(p => [p.id, p.model, p.url]), [['xai', 'grok-4.7', 'https://api.x.ai/v1/chat/completions']]);
  assert.equal(chain[0].key, KEY);
  assert.equal(JSON.stringify(store.rows.get('thisVioletHydra')), before, 'Roman chain and keys byte-identical');
});

test('valid key without credits is still added; bad key / bad format are not', async () => {
  const store = memoryStore();
  const noCredits = await addXaiToChain('vasya-pupkin', KEY, store.deps(async () => ({ ok: false, code: 'key-no-credits', message: 'ключ верный, но нет кредитов' })));
  assert.equal(noCredits.ok, true);
  assert.match(noCredits.detail, /нет кредитов/);
  const again = await addXaiToChain('vasya-pupkin', KEY, store.deps(async () => ({ ok: true, code: 'ok', message: '' })));
  assert.equal(again.ok, true);
  assert.equal(JSON.parse(store.rows.get('vasya-pupkin').modelChain).length, 1, 'one xai entry, replaced');
  const bad = await addXaiToChain('vasya-pupkin', KEY, store.deps(async () => ({ ok: false, code: 'bad-key', message: 'неверный ключ' })));
  assert.deepEqual(bad, { ok: false, detail: 'неверный ключ' });
  const format = await addXaiToChain('vasya-pupkin', 'sk-nope', store.deps(async () => { throw new Error('must not test'); }));
  assert.equal(format.ok, false);
  assert.deepEqual(store.writes, ['vasya-pupkin', 'vasya-pupkin']);
  assert.equal(store.rows.get('thisVioletHydra').modelChain, ROMAN);
});

test('admin action takes the login from the session only', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./src/lib/server/admin-actions.ts', import.meta.url), 'utf8');
  const action = src.slice(src.indexOf('export async function wizardProviderAdmin'));
  assert.match(action, /const login = guard\(cookies\)/);
  assert.equal(/form\.get\('login'\)/.test(action), false);
});

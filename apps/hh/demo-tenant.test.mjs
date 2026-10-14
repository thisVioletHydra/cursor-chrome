// Demo account «Вася Пупкин»: own empty DB under tenants/vasya-pupkin, never our server LLM key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-tenant-')));
process.env.HH_STORE = path.join(root, 'hh.json');
delete process.env.RAILWAY_ENVIRONMENT;
const { runTenant } = await import('./src/diary/tenant.ts');
const { countSeen, hhDatabase, insertSeen, openStore } = await import('./src/diary/seen-db.ts');
const { chainFromEnv } = await import('./src/model/model.ts');

test('vasya-pupkin gets an empty DB of his own; owner data stays out of it', async () => {
  await runTenant('thisVioletHydra', () => openStore());
  await runTenant('vasya-pupkin', () => openStore());
  await runTenant('thisVioletHydra', () => openStore());
  await runTenant('vasya-pupkin', () => openStore());
  await runTenant('thisVioletHydra', () => insertSeen(['111', '222', '333'], Date.now()));
  assert.equal(runTenant('thisVioletHydra', () => countSeen()), 3);
  assert.equal(runTenant('vasya-pupkin', () => countSeen()), 0);
  const where = runTenant('vasya-pupkin', () => hhDatabase().location());
  assert.ok(where.includes(path.join('tenants', 'vasya-pupkin')), where);
  assert.equal(fs.realpathSync(where).startsWith(root), true, where);
  await runTenant('vasya-pupkin', () => insertSeen(['999'], Date.now()));
  assert.equal(runTenant('thisVioletHydra', () => countSeen()), 3, 'vasya writes never reach the owner DB');
});

test('our server key (MODEL_CHAIN) is never handed to vasya-pupkin', () => {
  process.env.MODEL_CHAIN = JSON.stringify([{ id: 'groq', key: 'fake-server-key-0000' }]);
  try {
    assert.ok(chainFromEnv().length > 0, 'others still get the server chain');
    assert.deepEqual(runTenant('vasya-pupkin', () => chainFromEnv()), []);
  }
  finally {
    delete process.env.MODEL_CHAIN;
  }
});

test('storePath: invalid tenant login throws, empty login and owner stay on root', async () => {
  const { runTenant, storePath } = await import('./src/index.ts');
  const root = storePath();
  assert.equal(runTenant('thisVioletHydra', () => storePath()), root);
  assert.equal(runTenant('', () => storePath()), root);
  assert.match(runTenant('some-user', () => storePath()), /tenants[\\/]some-user[\\/]hh\.sqlite$/);
  for (const bad of ['../x', 'a/b', 'x'.repeat(40), 'имя'])
    assert.throws(() => runTenant(bad, () => storePath()), /tenant login/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
process.env.HH_STORE = path.join(dir, 'hh.sqlite');
const { readMemory, remember } = await import('./src/diary/memory.ts');
const { runTenant } = await import('./src/diary/tenant.ts');

test('второй аккаунт после первого: база открывается, без «база не открыта»', async () => {
  await runTenant('vasya-pupkin', () => remember(['1']));
  await runTenant('thisVioletHydra', () => remember(['2']));
  await runTenant('someone-else', () => readMemory());
  assert.ok(fs.existsSync(path.join(dir, 'hh.sqlite')));
  assert.ok(fs.existsSync(path.join(dir, 'tenants', 'vasya-pupkin', 'hh.sqlite')));
});

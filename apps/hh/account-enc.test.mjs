import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadOwnerAccount, readAccountFile } from './src/model/account.ts';
import { encryptFields, SecretKeyError } from './src/model/secret-box.ts';

test('hh читает зашифрованный аккаунт и получает открытые ключи', async () => {
  const key = crypto.randomBytes(32).toString('base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  const file = path.join(dir, 'a.json');
  const plain = { modelChain: '[{"key":"sk-fake"}]', telegramToken: 't-fake', coverLetter: 'Привет' };
  fs.writeFileSync(file, JSON.stringify(encryptFields(plain, key)));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-fake'));
  const old = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = key;
  try {
    const r = await loadOwnerAccount(file);
    assert.equal(r.found, true);
    assert.equal(r.applied.coverLetter, 'Привет');
    assert.deepEqual(await readAccountFile(file), plain);
    process.env.SECRETS_KEY = crypto.randomBytes(32).toString('base64');
    await assert.rejects(readAccountFile(file), SecretKeyError);
    delete process.env.SECRETS_KEY;
    const cli = await loadOwnerAccount(file);
    assert.equal(cli.found, true);
    assert.equal(cli.applied.coverLetter, 'Привет');
  }
  finally {
    if (old === undefined) delete process.env.SECRETS_KEY; else process.env.SECRETS_KEY = old;
  }
});

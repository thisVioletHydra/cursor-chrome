import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { decryptFields, decryptValue, encryptFields, encryptValue, isEncrypted, SecretKeyError } from '../hh/src/model/secret-box.ts';

const K = crypto.randomBytes(32).toString('base64');
const K2 = crypto.randomBytes(32).toString('base64');
const S = 'sk-fake-not-real';

test('шифр/дешифр', () => {
  const e = encryptValue(S, K);
  assert.ok(e.startsWith('enc:v1:'));
  assert.ok(!e.includes(S));
  assert.equal(decryptValue(e, K), S);
});

test('старый открытый формат читается', () => {
  assert.equal(decryptValue(S, K), S);
  assert.equal(decryptValue(S, undefined), S);
});

test('без ключа пишет открыто', () => {
  assert.equal(encryptValue(S, undefined), S);
});

test('неверный ключ — понятная ошибка, не пустота', () => {
  const e = encryptValue(S, K);
  assert.throws(() => decryptValue(e, K2), SecretKeyError);
  assert.throws(() => decryptValue(e, undefined), SecretKeyError);
});

test('поля: только секретные, повторно не шифрует', () => {
  const a = { telegramToken: S, modelChain: '[{"key":"x"}]', hhQuery: 'q', hhAccessToken: '' };
  const e = encryptFields(a, K);
  assert.ok(isEncrypted(e.telegramToken) && isEncrypted(e.modelChain));
  assert.equal(e.hhQuery, 'q');
  assert.equal(e.hhAccessToken, '');
  assert.equal(encryptFields(e, K).telegramToken, e.telegramToken);
  assert.deepEqual(decryptFields(e, K), a);
});

test('tokenMatches: SecretKeyError → false и лог, вход остальным не ломается', () => {
  const fs = globalThis.process.getBuiltinModule('node:fs');
  const text = fs.readFileSync(new URL('./src/lib/server/secrets.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('async function tokenMatches'), text.indexOf('async function tokenMatches') + 700);
  assert.match(body, /catch \(error\)/);
  assert.match(body, /instanceof SecretKeyError/);
  assert.match(body, /return false;/);
  assert.ok(!/extToken|given/.test(body.slice(body.indexOf('console.error'), body.indexOf('return false;'))), 'лог без секретов');
});

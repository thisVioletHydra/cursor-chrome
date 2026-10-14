import { ownerAccount, personalValues, readRepo, sourceFiles, leaks } from '../hh/personal-guard.mjs';
import { standardValue, valueRe } from './src/local/standard-fill.ts';
import { parseProfile } from '../hh/src/review/profile.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const OWNER = personalValues();

test('extension sources carry no values from the local account', { skip: !OWNER && 'нет локального файла аккаунта' }, () => {
  const found = sourceFiles(['apps/extension/src']).flatMap(file => leaks(readRepo(file), OWNER).map(key => `${file}: ${key}`));
  assert.deepEqual(found, []);
});

test('standard screening answers come from the profile (fakes); empty profile → nothing', () => {
  const profile = { version: 1, savedAt: 1, custom: [], fields: { city: { mode: 'fixed', value: 'Тестоград' }, salary: { mode: 'fixed', value: 'по договорённости' }, citizenship: { mode: 'conditions', cases: [{ when: [{ field: 'city', op: 'is', value: 'Москва' }], value: 'РФ' }], otherwise: 'Тестония' } } };
  assert.equal(standardValue('city', profile), 'Тестоград');
  assert.equal(standardValue('pay', profile), 'по договорённости');
  assert.equal(standardValue('citizen', profile), 'Тестония');
  assert.equal(standardValue('citizen', profile, { city: 'Москва' }), 'РФ');
  assert.equal(standardValue('city', null), '');
  assert.equal(standardValue('pay', { ...profile, fields: {} }), '');
  assert.equal(valueRe('Тестоград').test('Тестоградская обл.'), true);
  assert.equal(valueRe('по договорённости').test('По договорённости'), true);
  const fill = readRepo('apps/extension/src/hh/apply-fill.ts');
  assert.match(fill, /fromProfile\('city'/);
  assert.match(fill, /нужен твой ответ/);
});

test("owner's real profile still answers city / pay (values not printed)", { skip: !ownerAccount() && 'нет локального файла аккаунта' }, () => {
  const profile = parseProfile(ownerAccount().profile);
  for (const kind of ['city', 'pay'])
    assert.ok(standardValue(kind, profile).length > 0, kind);
  assert.ok(String(ownerAccount().coverLetter || '').trim().length > 0, 'owner letter lives in the account');
});

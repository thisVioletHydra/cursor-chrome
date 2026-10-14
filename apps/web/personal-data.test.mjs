import { leaks, personalValues, readRepo, sourceFiles } from '../hh/personal-guard.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

const OWNER = personalValues();

test('web + hh + mcp sources carry no values from the local account', { skip: !OWNER && 'нет локального файла аккаунта' }, () => {
  const found = sourceFiles(['apps/web/src', 'apps/hh/src', 'apps/mcp/src']).flatMap(file => leaks(readRepo(file), OWNER).map(key => `${file}: ${key}`));
  assert.deepEqual(found, []);
});

test('hh contact e-mail is not hardcoded in the web UA', () => {
  assert.equal(/@(yandex|gmail|mail)\./.test(readRepo('apps/web/src/lib/server/checks.ts')), false);
});

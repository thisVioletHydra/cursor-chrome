import { shortCommit } from './src/lib/server/build-info.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('login header commit: Railway sha → 7 chars, override, git fallback, never throws', () => {
  assert.equal(shortCommit({ RAILWAY_GIT_COMMIT_SHA: 'A5EB89FA2CA0C35CBB7B3308F7A6207A6B517705' }, () => 'x'), 'a5eb89f');
  assert.equal(shortCommit({ BUILD_COMMIT: '1234567abc' }, () => 'x'), '1234567');
  assert.equal(shortCommit({}, () => 'deadbeefcafe\n'), 'deadbee');
  assert.equal(shortCommit({}, () => { throw new Error('no git'); }), '');
  assert.equal(shortCommit({ RAILWAY_GIT_COMMIT_SHA: 'not-a-sha' }, () => 'garbage'), '');
});

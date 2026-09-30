import { PAGE_LOAD_MS, pageLoadMiss } from './src/search/page-load.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('a search page load times out before a minute', () => {
  assert.equal(PAGE_LOAD_MS < 60_000, true);
  assert.equal(PAGE_LOAD_MS, 45_000);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS), false);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS + 1), true);
  assert.equal(pageLoadMiss(200_000), true);
});

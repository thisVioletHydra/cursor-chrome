import { SEARCH_HOURS_ENABLED } from './src/feature-flags.ts';
import { workHours } from './src/diary/memory.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

// 03:00 MSK = 00:00 UTC
const night = new Date('2026-10-14T00:00:00Z');
const day = new Date('2026-10-14T09:00:00Z');

test('flag defaults to off', () => {
  assert.equal(SEARCH_HOURS_ENABLED, false);
});

test('flag off: search allowed at 03:00 MSK even with the hours setting on', () => {
  assert.equal(workHours(night), true);
  assert.equal(workHours(night, false), true);
});

test('flag on keeps the old window', () => {
  assert.equal(workHours(night, true), false);
  assert.equal(workHours(day, true), true);
});

import { hhUserAgent } from './src/limits.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('hh User-Agent fallback uses product name', () => {
  assert.equal(hhUserAgent({}), 'NoJobNoProblemBuddy-hh');
  assert.equal(hhUserAgent({ HH_CONTACT_EMAIL: '  ' }), 'NoJobNoProblemBuddy-hh');
});

test('hh User-Agent carries contact from env', () => {
  assert.equal(hhUserAgent({ HH_CONTACT_EMAIL: 'a@example.com' }), 'NoJobNoProblemBuddy-hh (a@example.com)');
});

import { APP_USER_AGENT, hhUserAgent } from './src/limits.ts';
import rootPackage from '../../package.json' with { type: 'json' };

import assert from 'node:assert/strict';
import test from 'node:test';

test('hh User-Agent fallback uses product name', () => {
  assert.equal(hhUserAgent({}), APP_USER_AGENT);
  assert.equal(hhUserAgent({ HH_CONTACT_EMAIL: '  ' }), APP_USER_AGENT);
});

test('hh User-Agent carries contact from env', () => {
  assert.equal(hhUserAgent({ HH_CONTACT_EMAIL: 'a@example.com' }), `${APP_USER_AGENT} (a@example.com)`);
});

test('User-Agent нейтральный: NoJobNoProblemBuddy/<версия>, без hh', () => {
  assert.equal(APP_USER_AGENT, `NoJobNoProblemBuddy/${rootPackage.version}`);
  assert.doesNotMatch(APP_USER_AGENT, /hh/i);
});

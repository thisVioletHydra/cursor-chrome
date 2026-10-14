import { devBypass, warnIgnoredBypass } from './src/lib/server/dev-auth.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const base = { flag: '1', nodeEnv: 'development', railway: undefined, devServer: true, hostname: 'localhost' };

test('bypass works on the dev server for local hosts only', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]'])
    assert.equal(devBypass({ ...base, hostname }), true, hostname);

  assert.equal(devBypass({ ...base, hostname: 'example.com' }), false);
  assert.equal(devBypass({ ...base, hostname: 'web-production-f8ad5.up.railway.app' }), false);
});

test('bypass is off without the flag or in production', () => {
  assert.equal(devBypass({ ...base, flag: undefined }), false);
  assert.equal(devBypass({ ...base, flag: 'true' }), false);
  assert.equal(devBypass({ ...base, nodeEnv: 'production' }), false);
  assert.equal(devBypass({ ...base, railway: 'production' }), false);
  assert.equal(devBypass({ ...base, devServer: false }), false);
});

test('production warns once per process', () => {
  const lines = [];
  const prod = { ...base, nodeEnv: 'production' };
  warnIgnoredBypass(base, line => lines.push(line));
  warnIgnoredBypass(prod, line => lines.push(line));
  warnIgnoredBypass(prod, line => lines.push(line));
  assert.equal(lines.length, 1);
});

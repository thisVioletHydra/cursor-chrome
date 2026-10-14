import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateOldDomain, moveHost, NEW_HOST } from './src/local/domain-move.ts';

const OLD = ['web', 'production', 'ab12c'].join('-') + '.up.railway.app';
const memArea = (data) => ({ data, writes: [], get: async keys => Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])), async set(items) { this.writes.push(Object.keys(items)); Object.assign(data, items); } });

test('moveHost: only the old host changes; path/hash/other hosts stay', () => {
  assert.equal(moveHost(`https://${OLD}`), `https://${NEW_HOST}`);
  assert.equal(moveHost(`https://${OLD}/admin`), `https://${NEW_HOST}/admin`);
  assert.equal(moveHost(`https://${OLD}/connect#abc`), `https://${NEW_HOST}/connect#abc`);
  assert.equal(moveHost('https://other.example'), 'https://other.example');
  assert.equal(moveHost('not a url'), 'not a url');
});

test('migrateOldDomain: rewrites URL + gate host only, token untouched, idempotent', async () => {
  const token = 'tok_' + 'x'.repeat(30);
  const area = memArea({ applySyncUrl: `https://${OLD}`, applySyncKey: token, linkGate: { state: 'ok', host: OLD, at: 5, login: 'r' }, applyLog: [{ id: 1 }] });
  assert.deepEqual(await migrateOldDomain(area), ['applySyncUrl', 'linkGate']);
  assert.equal(area.data.applySyncUrl, `https://${NEW_HOST}`);
  assert.deepEqual(area.data.linkGate, { state: 'ok', host: NEW_HOST, at: 5, login: 'r' });
  assert.equal(area.data.applySyncKey, token);
  assert.deepEqual(area.data.applyLog, [{ id: 1 }]);
  assert.deepEqual(area.writes.flat().sort(), ['applySyncUrl', 'linkGate']);
  assert.deepEqual(await migrateOldDomain(area), [], 'second run is a no-op');
  assert.equal(area.writes.length, 2);
  const empty = memArea({});
  assert.deepEqual(await migrateOldDomain(empty), []);
  assert.equal(empty.writes.length, 0);
});

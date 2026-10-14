import { cleanSignals, demoLoginAllowed, openAccess, PASS_MS, safeLogLine, scoreSignals, sha256, zoneOf } from './src/lib/server/access.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = () => openAccess(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'access-')), 'a.sqlite'));
const h = text => sha256(text);
const device = (id, over = {}) => ({ deviceId: h(id), gpu: h('rtx 4050'), os: h('win'), fonts: h('f'), screen: h('1920'), cores: h('8'), memory: h('8'), timezone: h('tz'), language: h('ru'), ...over });

test('tokens: only the hash is stored; revoke kills check-in', () => {
  const s = tmp();
  const token = s.issue('Вася', 'vasya-pupkin');
  const rows = s.db.prepare('SELECT * FROM access_token').all();
  assert.equal(rows[0].hash, sha256(token));
  assert.equal(JSON.stringify(rows).includes(token), false);
  assert.equal(s.checkIn(token, device('a')).status, 200);
  assert.ok(s.revoke(token));
  assert.equal(s.checkIn(token, device('a')).status, 401);
  assert.equal(s.checkIn('cct_wrong', device('a')).status, 401);
});

test('score zones: 8–10 match + reference update, 5–7 flagged, <5 new slot; third device 403; unbind frees', () => {
  const s = tmp();
  const token = s.issue('t', 'vasya-pupkin');
  const first = s.checkIn(token, device('a'));
  assert.equal(first.slot, 1); assert.equal(first.zone, 'new');
  const again = s.checkIn(token, device('a'));
  assert.equal(again.score, 10); assert.equal(again.zone, 'match'); assert.equal(again.slot, 1);
  const gpu = s.checkIn(token, device('a', { gpu: h('rtx 5070') }));
  assert.equal(gpu.score, 8.5); assert.equal(gpu.zone, 'match');
  // reference updated → the new card is now the norm
  assert.equal(s.checkIn(token, device('a', { gpu: h('rtx 5070') })).score, 10);
  const moved = s.checkIn(token, device('a', { gpu: h('rtx 5070'), os: h('linux'), fonts: h('g'), screen: h('2k'), timezone: h('x') }));
  assert.equal(moved.zone, 'flagged'); assert.equal(moved.slot, 1);
  const second = s.checkIn(token, device('b', { gpu: h('m2'), os: h('mac'), fonts: h('m'), screen: h('r') }));
  assert.equal(second.zone, 'new'); assert.equal(second.slot, 2);
  const third = s.checkIn(token, device('c', { gpu: h('arc'), os: h('l'), fonts: h('z'), screen: h('q') }));
  assert.equal(third.status, 403);
  const id = s.list()[0].id;
  assert.ok(s.unbind(id, 1));
  assert.equal(s.checkIn(token, device('c', { gpu: h('arc'), os: h('l'), fonts: h('z'), screen: h('q') })).slot, 1);
  assert.equal(zoneOf(7.9), 'flagged'); assert.equal(zoneOf(4.9), 'new');
  assert.equal(scoreSignals({}, device('a')).score, 0);
});

test('4-hour pass + daily limit', () => {
  const s = tmp();
  const token = s.issue('t', 'vasya-pupkin', 3);
  const now = Date.now();
  const res = s.checkIn(token, device('a'), now);
  assert.equal(res.passExpires, now + PASS_MS);
  assert.equal(s.usePass(res.pass, now).status, 200);
  assert.equal(s.usePass(res.pass, now).status, 200);
  assert.equal(s.usePass(res.pass, now).used, 3);
  assert.equal(s.usePass(res.pass, now).status, 429);
  assert.equal(s.usePass(res.pass, now + PASS_MS + 1).status, 401);
  assert.equal(s.usePass('ccp_fake').status, 401);
  assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM access_pass').all()).includes(res.pass), false);
});

test('signals: only hashes accepted; logs carry no bodies or keys', () => {
  assert.deepEqual(cleanSignals({ deviceId: 'raw-uuid', gpu: h('x'), evil: h('y') }), { gpu: h('x') });
  const line = safeLogLine('POST', '/api/access/check?token=cct_abc', 200, sha256('cct_abc'));
  assert.equal(line.includes('cct_abc'), false);
  const s = tmp();
  const token = s.issue('t', 'vasya-pupkin');
  s.checkIn(token, device('a'));
  assert.equal(JSON.stringify(s.events()).includes(token), false);
});

test('DEMO_TOKEN_LOGIN gate: flag on, not Railway, demo login only', () => {
  assert.equal(demoLoginAllowed({ DEMO_TOKEN_LOGIN: '1' }, 'vasya-pupkin'), true);
  assert.equal(demoLoginAllowed({}, 'vasya-pupkin'), false);
  assert.equal(demoLoginAllowed({ DEMO_TOKEN_LOGIN: '1', RAILWAY_ENVIRONMENT: 'production' }, 'vasya-pupkin'), false);
  assert.equal(demoLoginAllowed({ DEMO_TOKEN_LOGIN: '1' }, 'thisVioletHydra'), false);
  assert.equal(demoLoginAllowed({ DEMO_TOKEN_LOGIN: '1' }, null), false);
});

test('gate for all extension endpoints: legacy login passes, token login needs a pass, revoked → 403', () => {
  const s = tmp();
  assert.equal(s.gate('thisVioletHydra', '').ok, true);
  assert.equal(s.gate('thisVioletHydra', '').mode, 'legacy');
  const token = s.issue('Вася', 'vasya-pupkin', 2);
  assert.equal(s.gate('vasya-pupkin', '').status, 403);
  assert.equal(s.gate('vasya-pupkin', 'ccp_fake').status, 403);
  const { pass } = s.checkIn(token, device('a'));
  assert.equal(s.gate('vasya-pupkin', pass).ok, true);
  assert.equal(s.gate('thisVioletHydra', pass).ok, true);
  assert.equal(s.gate('vasya-pupkin', pass).ok, true);
  assert.equal(s.gate('vasya-pupkin', pass).status, 429);
  const other = s.issue('Петя', 'petya', 10);
  const petya = s.checkIn(other, device('p')).pass;
  assert.equal(s.gate('vasya-pupkin', petya).status, 403);
  s.revoke(token);
  assert.equal(s.gate('vasya-pupkin', pass).status, 403);
  // third device: no slot → no pass → 403 on every endpoint
  const t3 = s.issue('slots', 'slots-user');
  s.checkIn(t3, device('1', { gpu: h('1'), os: h('1'), fonts: h('1'), screen: h('1') }));
  s.checkIn(t3, device('2', { gpu: h('2'), os: h('2'), fonts: h('2'), screen: h('2') }));
  const third = s.checkIn(t3, device('3', { gpu: h('3'), os: h('3'), fonts: h('3'), screen: h('3') }));
  assert.equal(third.status, 403); assert.equal(third.pass, null);
  assert.equal(s.gate('slots-user', '').status, 403);
});

test('access DB path: Railway volume /data, WEB_SECRETS dir, local ./data, ACCESS_DB override', async () => {
  const { accessFile } = await import('./src/lib/server/access.ts');
  assert.equal(accessFile({ RAILWAY_ENVIRONMENT: 'production' }, '/app'), '/data/access.sqlite');
  assert.equal(accessFile({ WEB_SECRETS: '/x/y/web-secrets.json' }, '/app'), '/x/y/access.sqlite');
  assert.equal(accessFile({}, '/app'), '/app/data/access.sqlite');
  assert.equal(accessFile({ ACCESS_DB: '/t/a.sqlite', RAILWAY_ENVIRONMENT: '1' }, '/app'), '/t/a.sqlite');
  // fresh DB: empty tables → every login is legacy
  const s = tmp();
  assert.deepEqual(s.list(), []);
  assert.equal(s.gate('thisVioletHydra', '').mode, 'legacy');
});

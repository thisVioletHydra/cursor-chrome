import { hashRaw, normalizeRaw, openAccess, sha256, signalsOf } from './src/lib/server/access.ts';
import { CONFIG, configBody } from './src/lib/server/thin/config.ts';
import { DL_MS, signDl, verifyDl, zipDir } from './src/lib/server/thin/dl.ts';
import { compareVersions, policyOf, versionGate } from './src/lib/server/thin/version.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thin-'));
const RAW = { deviceId: 'dev-raw-1', gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', os: 'macOS', fonts: 'Menlo,Arial', screen: '1920x1080@2', cores: '8', memory: '8', timezone: 'Etc/Test', language: 'ru-RU' };

test('fingerprint: server normalizes + hashes raw signals, stores no raw values', () => {
  assert.equal(normalizeRaw(RAW).gpu, 'nvidia rtx 4050');
  assert.equal(normalizeRaw(RAW).fonts, 'Arial,Menlo');
  const a = hashRaw(RAW, 'pepper-1').signals;
  assert.notDeepEqual(a, hashRaw(RAW, 'pepper-2').signals, 'keyed hash');
  const s = openAccess(path.join(tmpDir(), 'a.sqlite'));
  const token = s.issue('test', 'test_user');
  const first = s.checkBody(token, { raw: RAW });
  assert.equal(first.status, 200);
  const again = s.checkBody(token, { raw: { ...RAW, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028E1) Direct3D11, D3D11-31.0)' } });
  assert.equal(again.zone, 'match');
  assert.equal(again.score, 10, 'driver noise does not change the gpu chip');
  const dump = JSON.stringify(s.db.prepare('SELECT * FROM access_device').all()) + JSON.stringify(s.db.prepare('SELECT * FROM access_log').all());
  for (const value of ['dev-raw-1', 'Etc/Test', 'RTX 4050', 'nvidia rtx 4050', 'Menlo'])
    assert.equal(dump.includes(value), false, `no raw ${value} in DB`);
});

test('fingerprint: old clients (sha256 hashes) still match; their device migrates to server hashes', () => {
  const s = openAccess(path.join(tmpDir(), 'a.sqlite'));
  const token = s.issue('test', 'test_user');
  const clean = normalizeRaw(RAW);
  const old = Object.fromEntries(Object.entries(clean).map(([name, value]) => [name, sha256(`${name}:${value}`)]));
  assert.equal(s.checkBody(token, { signals: old }).status, 200);
  const next = s.checkBody(token, { raw: RAW });
  assert.equal(next.zone, 'match', 'legacy ref matched by the legacy hash of raw signals');
  assert.equal(signalsOf({ signals: old }).legacy, null);
  assert.equal(s.checkBody(token, { raw: { ...RAW, deviceId: 'other', gpu: 'intel', os: 'linux' } }).slot, 2, 'weights and thresholds on the server');
});

test('config: version + stable ETag', () => {
  const one = configBody();
  assert.equal(one.etag, configBody().etag);
  assert.equal(JSON.parse(one.text).version, CONFIG.version);
  assert.deepEqual(JSON.parse(one.text).order, ['rule', 'profile', 'human', 'memory', 'llm']);
  assert.ok(JSON.parse(one.text).selectors.taskQuestion);
  assert.notEqual(configBody({ ...CONFIG, version: CONFIG.version + 1 }).etag, one.etag);
});

test('versions: env with defaults; below recommended → flag, below min → 426 except config and dl', () => {
  assert.deepEqual(policyOf({}, '0.5.127'), { min: '0.0.0', recommended: '0.5.127' });
  const policy = policyOf({ EXT_MIN_VERSION: '0.5.0', EXT_RECOMMENDED_VERSION: '0.6.0' }, '0.5.127');
  assert.equal(compareVersions('0.5.10', '0.5.9'), 1);
  assert.deepEqual(versionGate('/api/queue', '0.5.127', policy), { status: 200, outdated: true });
  assert.deepEqual(versionGate('/api/queue', '0.6.0', policy), { status: 200, outdated: false });
  assert.deepEqual(versionGate('/api/queue', '0.4.9', policy), { status: 426, outdated: true });
  assert.equal(versionGate('/api/config', '0.4.9', policy).status, 200);
  assert.equal(versionGate('/dl/x', '0.4.9', policy).status, 200);
  assert.equal(versionGate('/api/queue', null, policy).status, 200, 'old extension without the header keeps working');
});

test('dl: HMAC link, 24 h, bound to the user token; zip of dist', async () => {
  const now = 1_000_000;
  const link = signDl('test_user', 'ext_tok_A', 'secret', now);
  const tokenOf = token => async () => token;
  assert.deepEqual(await verifyDl(link, 'secret', tokenOf('ext_tok_A'), now + 1000), { ok: true, login: 'test_user' });
  assert.equal((await verifyDl(link, 'secret', tokenOf('ext_tok_B'), now + 1000)).ok, false, 'reissued extToken kills the link');
  assert.equal((await verifyDl(link, 'other', tokenOf('ext_tok_A'), now + 1000)).ok, false);
  assert.equal((await verifyDl(link, 'secret', tokenOf('ext_tok_A'), now + DL_MS + 1)).ok, false, 'expires in 24 h');
  const [head, sig] = link.split('.');
  const forged = `${Buffer.from(JSON.stringify({ l: 'admin', e: now + DL_MS })).toString('base64url')}.${sig}`;
  assert.equal((await verifyDl(forged, 'secret', tokenOf('ext_tok_A'), now)).ok, false);
  assert.ok(head);
  assert.equal(link.includes('ext_tok_A'), false);

  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'icons'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{"version":"0.6.0"}');
  fs.writeFileSync(path.join(dir, 'icons', 'a.txt'), 'x'.repeat(1000));
  const zip = zipDir(dir);
  assert.equal(zip.readUInt32LE(0), 0x04034B50);
  const nameLen = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLen).toString(), 'icons/a.txt');
  const packed = zip.subarray(30 + nameLen, 30 + nameLen + zip.readUInt32LE(18));
  assert.equal(zlib.inflateRawSync(packed).toString(), 'x'.repeat(1000));
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
});

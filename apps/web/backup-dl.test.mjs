import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite from 'node:sqlite';
import { test } from 'node:test';
import zlib from 'node:zlib';

import { backupResponse, maskAccount } from './src/lib/server/backup-dl.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SECRET = 'sk-fake-secret-not-real';

function unzip(buf) {
  const out = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034B50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString();
    const start = at + 30 + nameLen;
    out[name] = zlib.inflateRawSync(buf.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-'));
  const db = path.join(dir, 'hh.sqlite');
  const live = new sqlite.DatabaseSync(db);
  live.exec('PRAGMA journal_mode = WAL; CREATE TABLE seen (id INTEGER PRIMARY KEY, at INTEGER); INSERT INTO seen VALUES (1, 2), (3, 4);');
  const account = { telegramToken: SECRET, modelChain: JSON.stringify([{ id: 'x', key: SECRET }]), hhAccessToken: SECRET, hhClientId: SECRET, hhClientSecret: SECRET, extToken: SECRET, hhQuery: 'golang', balance: 5, apiKey: SECRET };
  return { dir, db, live, account };
}

const req = (origin = 'https://app.test', method = 'POST') => new Request('https://app.test/admin/backup', { method, headers: origin ? { origin } : {} });
const jar = obj => name => obj[name];
const depsFor = (f, seen = []) => ({
  readSession: raw => (raw === 'ok' ? { login: 'someone' } : raw === 'creator' ? { login: 'boss' } : raw === 'demo' ? { login: 'vasya-pupkin' } : null),
  allowed: () => true,
  isCreator: login => login === 'boss',
  accountText: async (login) => { seen.push(login); return JSON.stringify(f.account); },
  dbFile: (login) => { seen.push(`db:${login}`); return f.db; },
});

test('maskAccount: known and secret-looking fields masked, rest kept', () => {
  const { account, masked } = maskAccount({ extToken: 'x', telegramToken: '', hhQuery: 'q', someKey: 'y' });
  assert.equal(account.extToken, '***');
  assert.equal(account.telegramToken, '');
  assert.equal(account.hhQuery, 'q');
  assert.equal(account.someKey, '***');
  assert.deepEqual(masked, ['extToken', 'someKey', 'telegramToken']);
});

test('maskAccount: nested objects, arrays and JSON-in-string masked with paths', () => {
  const { account, masked } = maskAccount({ profile: { apiKey: 'k', name: 'n' }, list: [{ key: 'z' }, { ok: 1 }], notes: JSON.stringify({ token: 't', x: 1 }) });
  assert.equal(account.profile.apiKey, '***');
  assert.equal(account.profile.name, 'n');
  assert.equal(account.list[0].key, '***');
  assert.deepEqual(JSON.parse(account.notes), { token: '***', x: 1 });
  assert.deepEqual(masked, ['list[0].key', 'notes.token', 'profile.apiKey']);
  assert.ok(!JSON.stringify(account).includes('"k"'));
});

test('guards: GET 405, foreign/missing Origin 403, no session 401, guest preview 403; all no-store', async () => {
  const f = fixture();
  const d = depsFor(f);
  const cases = [
    [req('https://app.test', 'GET'), {}, 405],
    [req('https://evil.test'), { session: 'ok' }, 403],
    [req(''), { session: 'ok' }, 403],
    [req(), {}, 401],
    [req(), { session: 'creator', preview: 'guest' }, 403],
  ];
  for (const [r, c, status] of cases) {
    const res = await backupResponse(r, jar(c), d);
    assert.equal(res.status, status);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  f.live.close();
});

test('zip: only own account, secrets masked and listed, sqlite copied while live connection is open', async () => {
  const f = fixture();
  const seen = [];
  const res = await backupResponse(req(), jar({ session: 'ok' }), depsFor(f, seen));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.deepEqual(seen, ['someone', 'db:someone']);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(!buf.includes(SECRET));
  const files = unzip(buf);
  assert.deepEqual(Object.keys(files).sort(), ['account.json', 'hh.sqlite', 'manifest.json']);
  const manifest = JSON.parse(files['manifest.json']);
  assert.equal(manifest.login, 'someone');
  assert.deepEqual(manifest.maskedSecrets, ['apiKey', 'extToken', 'hhAccessToken', 'hhClientId', 'hhClientSecret', 'modelChain', 'telegramToken']);
  const account = JSON.parse(files['account.json']);
  assert.equal(account.hhQuery, 'golang');
  assert.equal(account.modelChain, '***');
  const copy = path.join(f.dir, 'copy.sqlite');
  fs.writeFileSync(copy, files['hh.sqlite']);
  const check = new sqlite.DatabaseSync(copy, { readOnly: true });
  assert.equal(check.prepare('SELECT count(*) AS n FROM seen').get().n, 2);
  check.close();
  f.live.exec('INSERT INTO seen VALUES (5, 6)');
  f.live.close();
  assert.equal(fs.readdirSync(f.dir).filter(n => n.startsWith('nj-backup')).length, 0);
});

test('demo account may download; missing db and account → manifest says missing', async () => {
  const f = fixture();
  const res = await backupResponse(req(), jar({ session: 'demo' }), { ...depsFor(f), accountText: async () => null, dbFile: () => path.join(f.dir, 'none.sqlite') });
  assert.equal(res.status, 200);
  const manifest = JSON.parse(unzip(Buffer.from(await res.arrayBuffer()))['manifest.json']);
  assert.equal(manifest.login, 'vasya-pupkin');
  assert.equal(manifest.account, 'missing');
  assert.equal(manifest.database, 'missing');
  assert.ok(!fs.existsSync(path.join(f.dir, 'none.sqlite')));
  f.live.close();
});

test('route + UI wiring: POST-only, read-only, tenant path, hint text', () => {
  const route = read('./src/routes/admin/backup/+server.ts');
  assert.match(route, /export const POST/);
  assert.doesNotMatch(route, /export const GET|writeAccount|ensureAccount|newExtToken/);
  assert.match(route, /runTenant\(login, \(\) => storePath\(\)\)/);
  const page = read('./src/routes/admin/profile/+page.svelte');
  assert.match(page, /fetch\('\/admin\/backup', \{ method: 'POST' \}\)/);
  assert.match(page, /Данные расширения сохраняй через «Экспорт JSON» в расширении/);
});

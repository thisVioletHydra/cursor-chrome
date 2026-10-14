import { mapXaiStatus, testXaiKey, validXaiKey, XAI_CHAT_URL, XAI_MODELS_URL } from './src/lib/server/thin/byok-check.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import test from 'node:test';

const KEY = `xai-${'Fake0Key1Test2'.repeat(5)}`;

async function intercept(fn) {
  const seen = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, out: process.stdout.write, err: process.stderr.write, wf: fs.writeFileSync, af: fs.appendFileSync };
  for (const name of ['log', 'info', 'warn', 'error', 'debug'])
    console[name] = (...args) => seen.push(args.map(String).join(' '));
  process.stdout.write = chunk => seen.push(String(chunk)) || true;
  process.stderr.write = chunk => seen.push(String(chunk)) || true;
  fs.writeFileSync = (file, data) => seen.push(`${file} ${data}`);
  fs.appendFileSync = (file, data) => seen.push(`${file} ${data}`);
  try {
    return { result: await fn(), seen };
  }
  finally {
    Object.assign(console, { log: keep.log, info: keep.info, warn: keep.warn, error: keep.error, debug: keep.debug });
    process.stdout.write = keep.out;
    process.stderr.write = keep.err;
    fs.writeFileSync = keep.wf;
    fs.appendFileSync = keep.af;
  }
}

test('key format: xai- prefix, length, allowed characters', () => {
  assert.equal(validXaiKey(KEY), true);
  assert.equal(validXaiKey(`  ${KEY}\n`), true);
  for (const bad of ['', 'xai-short', `sk-${'a'.repeat(40)}`, `xai-${'a'.repeat(30)} b`, `xai-${'a'.repeat(30)}!`, `xai-${'a'.repeat(300)}`])
    assert.equal(validXaiKey(bad), false, bad);
});

test('xAI responses → messages (mocked fetch)', async () => {
  const mock = (status, body = '') => async (url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${KEY}`);
    return url === XAI_MODELS_URL ? new Response(body, { status }) : new Response('{"choices":[]}', { status: 200 });
  };
  assert.equal((await testXaiKey(KEY, mock(200, '{"data":[]}'))).message, '✅ ключ работает');
  assert.equal((await testXaiKey(KEY, mock(401))).message, 'неверный ключ');
  assert.equal((await testXaiKey(KEY, mock(403))).message, 'неверный ключ');
  assert.equal((await testXaiKey(KEY, mock(402))).message, 'нет кредитов / лимит');
  assert.equal((await testXaiKey(KEY, mock(429))).message, 'нет кредитов / лимит');
  assert.equal((await testXaiKey(KEY, mock(403, '{"error":"Your team has no credits. Purchase credits"}'))).message, 'нет кредитов / лимит');
  assert.equal((await testXaiKey(KEY, async () => { throw new TypeError('fetch failed'); })).message, 'нет связи');
  assert.equal((await testXaiKey('nope', mock(200))).code, 'bad-format');
  assert.equal(mapXaiStatus(500).code, 'error');
});

test('the key never reaches logs, disk or the response', async () => {
  const echo = async () => new Response(`{"error":"Incorrect API key provided: ${KEY}"}`, { status: 401 });
  const { result, seen } = await intercept(() => testXaiKey(KEY, echo));
  assert.equal(seen.join('\n').includes(KEY), false);
  assert.equal(JSON.stringify(result).includes(KEY.slice(4, 20)), false);
  const route = fs.readFileSync(new URL('./src/routes/api/byok/[action=byoktest]/+server.ts', import.meta.url), 'utf8');
  assert.equal(/console\./.test(route), false);
  assert.equal(/console\.|writeFile|appendFile/.test(fs.readFileSync(new URL('./src/lib/server/thin/byok-check.ts', import.meta.url), 'utf8')), false);
});

test('valid key without credits: /v1/models 200, then 1-token chat says no credits', async () => {
  const calls = [];
  const mock = chat => async (url, init) => {
    calls.push({ url, body: init.body });
    return url === XAI_MODELS_URL ? new Response('{"data":[]}', { status: 200 }) : chat();
  };
  const ok = await testXaiKey(KEY, mock(() => new Response('{"choices":[{"message":{"content":"1"}}]}', { status: 200 })));
  assert.deepEqual([ok.ok, ok.message], [true, '✅ ключ работает']);
  assert.equal(calls[1].url, XAI_CHAT_URL);
  assert.equal(JSON.parse(calls[1].body).max_tokens, 1);
  for (const reply of [
    () => new Response('{"error":"no credits"}', { status: 402 }),
    () => new Response('{"error":"Your newly created team doesn\'t have any credits or licenses yet"}', { status: 403 }),
    () => new Response('{"error":"billing: spending limit reached"}', { status: 400 }),
  ]) {
    const got = await testXaiKey(KEY, mock(reply));
    assert.deepEqual([got.ok, got.code, got.message], [false, 'key-no-credits', 'ключ верный, но нет кредитов']);
  }
  assert.equal((await testXaiKey(KEY, mock(() => new Response('', { status: 429 })))).message, 'нет кредитов / лимит');
  assert.equal((await testXaiKey(KEY, mock(() => { throw new TypeError('fetch failed'); }))).message, 'нет связи');
  const bad = await testXaiKey(KEY, async () => new Response('', { status: 401 }));
  assert.equal(bad.message, 'неверный ключ', 'invalid key: no chat call');
});

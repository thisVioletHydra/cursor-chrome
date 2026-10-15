import { createBus, validate } from './src/lib/server/thin/cmd-bus.ts';
import { handleConfig, handleNext, handleReport } from './src/lib/server/thin/ext-cmd-api.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const quiet = { log: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = { kind: 'click', params: { selector: '#a' } };

test('queue: enqueue → next → report resolves enqueue promise, FIFO', async () => {
  const bus = createBus(quiet);
  const p1 = bus.enqueue('roman', click);
  const p2 = bus.enqueue('roman', { kind: 'wait', params: { ms: 10 } });
  const a = await bus.next('roman', undefined, 0);
  assert.equal(a.kind, 'click');
  assert.ok(a.deadline > Date.now());
  assert.deepEqual(bus.report('roman', { id: a.id, ok: true, result: { clicked: true } }), { status: 'ok' });
  assert.deepEqual(await p1, { ok: true, result: { clicked: true } });
  const b = await bus.next('roman', undefined, 0);
  assert.equal(b.kind, 'wait');
  bus.report('roman', { id: b.id, ok: false, error: 'нет элемента' });
  assert.deepEqual(await p2, { ok: false, error: 'нет элемента' });
  // duplicate report: idempotent ack, no second effect (the enqueue result stays the first one)
  assert.equal(bus.report('roman', { id: b.id, ok: true, result: 'второй' }).status, 'ok');
  assert.deepEqual(await p2, { ok: false, error: 'нет элемента' });
  assert.deepEqual(bus.stats(), { accounts: 0, polls: 0, queued: 0 });
});

test('long-poll wakes up on enqueue', async () => {
  const bus = createBus(quiet);
  const poll = bus.next('roman', undefined, 5000);
  bus.enqueue('roman', click);
  const got = await poll;
  assert.equal(got.kind, 'click');
});

test('isolation: other account never gets the command and cannot report it', async () => {
  const bus = createBus(quiet);
  const vasyaPoll = bus.next('vasya', undefined, 50);
  const p = bus.enqueue('roman', click);
  assert.equal(await vasyaPoll, null);
  const cmd = await bus.next('roman', undefined, 0);
  assert.equal(bus.report('vasya', { id: cmd.id, ok: true, result: 'evil' }).status, 'unknown');
  bus.report('roman', { id: cmd.id, ok: true, result: 'mine' });
  assert.deepEqual(await p, { ok: true, result: 'mine' });
  const many = await Promise.all(['a', 'b', 'c'].map(async (login) => {
    const r = bus.enqueue(login, { kind: 'read', params: { selector: `#${login}` } });
    const c = await bus.next(login, undefined, 0);
    bus.report(login, { id: c.id, ok: true, result: c.params.selector });
    return (await r).result;
  }));
  assert.deepEqual(many, ['#a', '#b', '#c']);
});

test('timeouts: execution timeout and queue TTL', async () => {
  const bus = createBus({ ...quiet, limits: { execMs: 30 } });
  const p = bus.enqueue('roman', click);
  await bus.next('roman', undefined, 0);
  assert.deepEqual(await p, { ok: false, error: 'таймаут выполнения' });
  let t = 0;
  const bus2 = createBus({ ...quiet, now: () => t, limits: { queueTtlMs: 1000 } });
  const q = bus2.enqueue('roman', click);
  t = 2000;
  assert.equal(await bus2.next('roman', undefined, 0), null);
  assert.equal((await q).ok, false);
  const poll = bus2.next('roman', undefined, 20);
  assert.equal(await poll, null, 'empty poll times out → null (204)');
});

test('new long-poll closes the old one; abort releases the poll', async () => {
  const bus = createBus(quiet);
  const old = bus.next('roman', undefined, 5000);
  const fresh = bus.next('roman', undefined, 5000);
  assert.equal(await old, null);
  assert.equal(bus.stats().polls, 1);
  bus.enqueue('roman', click);
  assert.equal((await fresh).kind, 'click');
  const ac = new AbortController();
  const p = bus.next('vasya', ac.signal, 5000);
  ac.abort();
  assert.equal(await p, null);
});

test('schema validation', async () => {
  assert.equal(validate(click), null);
  assert.equal(validate({ kind: 'navigate', params: { url: 'https://hh.ru/vacancy/1' } }), null);
  assert.match(validate({ kind: 'navigate', params: { url: 'javascript:alert(1)' } }), /https/);
  assert.match(validate({ kind: 'eval', params: {} }), /kind/);
  assert.match(validate({ kind: 'click', params: {} }), /selector/);
  assert.match(validate({ kind: 'click', params: { selector: 'a', code: 'x' } }), /лишние/);
  assert.match(validate({ kind: 'wait', params: {} }), /selector или ms/);
  assert.match(validate({ kind: 'hh_apply', params: { vacancyId: '12a' } }), /цифры/);
  assert.equal(validate({ kind: 'type', params: { selector: 'textarea', text: 'hi', submit: true } }), null);
  assert.equal(validate({ kind: 'select', params: { selector: 's', values: ['1'] } }), null);
  assert.equal(validate({ kind: 'press_key', params: { key: 'Enter' } }), null);
  assert.equal(validate({ kind: 'snapshot', params: {} }), null);
  const bus = createBus(quiet);
  await assert.rejects(bus.enqueue('roman', { kind: 'click', params: {} }), /отклонена/);
  await assert.rejects(bus.enqueue('', click), /login/);
  const full = createBus({ ...quiet, limits: { maxQueue: 1 } });
  full.enqueue('roman', click);
  await assert.rejects(full.enqueue('roman', click), /переполнена/);
});

test('report limits: size and shape', async () => {
  const bus = createBus({ ...quiet, limits: { maxResultBytes: 100 } });
  bus.enqueue('roman', click);
  const c = await bus.next('roman', undefined, 0);
  assert.equal(bus.report('roman', { id: c.id, ok: true, result: 'x'.repeat(200) }).status, 'too_big');
  assert.equal(bus.report('roman', { id: c.id }).status, 'bad');
  assert.equal(bus.report('roman', { id: c.id, ok: false }).status, 'bad');
  assert.equal(bus.report('roman', { id: c.id, ok: true }).status, 'ok');
});

test('logs carry no tokens and no DOM content', async () => {
  const lines = [];
  const bus = createBus({ log: (l) => lines.push(l) });
  const p = bus.enqueue('roman', { kind: 'type', params: { selector: '#t', text: 'СЕКРЕТНОЕ ПИСЬМО' } });
  const c = await bus.next('roman', undefined, 0);
  bus.report('roman', { id: c.id, ok: true, result: { html: '<div>ЛИЧНЫЕ ДАННЫЕ</div>' } });
  await p;
  const all = lines.join('\n');
  assert.ok(lines.length >= 3);
  assert.equal(all.includes('СЕКРЕТНОЕ'), false);
  assert.equal(all.includes('ЛИЧНЫЕ'), false);
});

const loginOf = async (req) => (req.headers.get('authorization') === 'Bearer good' ? 'roman' : null);
const req = (path, init = {}) => new Request(`http://x${path}`, init);

test('HTTP: 401 without token on next/report/config', async () => {
  for (const r of [handleNext(req('/api/ext/next'), loginOf), handleReport(req('/api/ext/report', { method: 'POST', body: '{}' }), loginOf), handleConfig(req('/api/ext/config'), loginOf), handleNext(req('/api/ext/next', { headers: { authorization: 'Bearer bad' } }), loginOf)])
    assert.equal((await r).status, 401);
});

test('HTTP: 204 on empty poll, 200 with command, report flow, config ETag', async () => {
  const bus = createBus(quiet);
  const auth = { authorization: 'Bearer good' };
  assert.equal((await handleNext(req('/n', { headers: auth }), loginOf, bus, 10)).status, 204);
  const done = bus.enqueue('roman', click);
  const r = await handleNext(req('/n', { headers: auth }), loginOf, bus, 10);
  assert.equal(r.status, 200);
  const cmd = await r.json();
  assert.equal((await handleReport(req('/r', { method: 'POST', headers: auth, body: 'nope' }), loginOf, bus)).status, 400);
  assert.equal((await handleReport(req('/r', { method: 'POST', headers: auth, body: JSON.stringify({ id: 'zzz', ok: true }) }), loginOf, bus)).status, 404);
  assert.equal((await handleReport(req('/r', { method: 'POST', headers: auth, body: JSON.stringify({ id: cmd.id, ok: true, result: 1 }) }), loginOf, bus)).status, 200);
  assert.deepEqual(await done, { ok: true, result: 1 });
  const big = 'x'.repeat(300 * 1024);
  assert.equal((await handleReport(req('/r', { method: 'POST', headers: auth, body: big }), loginOf, bus)).status, 413);
  const c1 = await handleConfig(req('/c', { headers: auth }), loginOf);
  assert.equal(c1.status, 200);
  const etag = c1.headers.get('etag');
  assert.ok((await c1.json()).selectors);
  assert.equal((await handleConfig(req('/c', { headers: { ...auth, 'if-none-match': etag } }), loginOf)).status, 304);
  await sleep(1);
});

test('lease: a picked command goes to one tab only; the same tab may re-poll it, another tab never', async () => {
  const bus = createBus(quiet);
  const p = bus.enqueue('roman', click);
  const a = await bus.next('roman', undefined, 0, 'tab-A');
  assert.equal(a.kind, 'click');
  assert.equal(await bus.next('roman', undefined, 0, 'tab-B'), null, 'other tab does not get it');
  assert.equal(await bus.next('roman', undefined, 0), null, 'anonymous poll does not get it');
  const again = await bus.next('roman', undefined, 0, 'tab-A');
  assert.equal(again.id, a.id, 'same tab re-poll (lost response) gets the same command');
  assert.equal(bus.report('roman', { id: a.id, ok: true, result: 1 }).status, 'ok');
  assert.equal(bus.report('roman', { id: a.id, ok: true, result: 2 }).status, 'ok');
  assert.deepEqual(await p, { ok: true, result: 1 });
  assert.equal(await bus.next('roman', undefined, 0, 'tab-A'), null, 'finished command is not re-sent');
});

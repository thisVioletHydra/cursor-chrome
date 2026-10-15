import assert from 'node:assert/strict';
import test from 'node:test';

import { lostGate, makeGateFetch } from './src/local/gate-fetch.ts';
import { FAST_PROBE_MS, gateOpen, probeDue, refreshGate } from './src/local/link-gate.ts';
import { makePowerQueue, waitUntil } from './src/pilot/power-queue.ts';
import { scrubHtml } from './src/local/fixture-scrub.ts';

const O = 'https://srv.test';
function area(gate) {
  const store = { linkGate: gate };
  return { store, get: async k => ({ [k]: store[k] }), set: async items => { Object.assign(store, items); } };
}
const okGate = now => ({ state: 'ok', host: 'srv.test', at: now - 1000, login: 'roman' });

test('gate-fetch: network error on an open gate → lost at once (fast), next queue/pulse never leave', async () => {
  const now = Date.now();
  const a = area(okGate(now));
  let sent = 0;
  const f = makeGateFetch(async () => { sent += 1; throw new TypeError('Failed to fetch'); }, a, () => O, () => now);
  await assert.rejects(f(`${O}/api/queue`));
  assert.equal(a.store.linkGate.state, 'down');
  assert.equal(a.store.linkGate.fast, true);
  assert.equal(gateOpen(a.store.linkGate, now), false);
  const r1 = await f(`${O}/api/queue`);
  const r2 = await f(`${O}/api/pulse`);
  assert.equal(r1.headers.get('x-cc-paused'), '1');
  assert.equal(r2.status, 503);
  assert.equal(sent, 1, 'nothing more leaves after the loss');
});

test('gate-fetch: 502/503/504 from our server close the gate; synthetic paused 503 and other hosts do not', async () => {
  for (const status of [502, 503, 504]) {
    const now = Date.now();
    const a = area(okGate(now));
    const f = makeGateFetch(async () => new Response('', { status }), a, () => O, () => now);
    assert.equal((await f(`${O}/api/queue`)).status, status);
    assert.equal(a.store.linkGate.state, 'down', String(status));
  }
  const now = Date.now();
  const a = area(okGate(now));
  const f = makeGateFetch(async () => new Response('', { status: 500 }), a, () => O, () => now);
  await f(`${O}/api/queue`);
  await f('https://hh.ru/x');
  assert.equal(a.store.linkGate.state, 'ok', '500 and foreign hosts leave the gate alone');
  // link check failing by network also closes it
  const b = area(okGate(now));
  const g = makeGateFetch(async () => { throw new TypeError('x'); }, b, () => O, () => now);
  await assert.rejects(g(`${O}/api/link`));
  assert.equal(b.store.linkGate.fast, true);
});

test('fast re-check: due after 2 s (not 30 s); server back → ok at once; still dead → normal backoff', async () => {
  const t = Date.now();
  const lost = lostGate(okGate(t), 'srv.test', t);
  assert.equal(probeDue(lost, t + FAST_PROBE_MS - 1), false);
  assert.equal(probeDue(lost, t + FAST_PROBE_MS), true);
  const a = area(lost);
  const back = await refreshGate(a, O, 'k'.repeat(20), async () => new Response('{"login":"roman"}', { status: 200 }), lost);
  assert.equal(gateOpen(back), true);
  const b = area(lost);
  const dead = await refreshGate(b, O, 'k'.repeat(20), async () => { throw new TypeError('x'); }, lost);
  assert.equal(dead.state, 'down');
  assert.equal(dead.fast, undefined);
  assert.equal(dead.fails, 2);
  assert.equal(probeDue(dead, dead.at + 2000), false, 'no more 2 s probes');
  // open gate failing its own live check → lost + fast
  const c = area(okGate(t));
  const viaCheck = await refreshGate(c, O, 'k'.repeat(20), async () => { throw new TypeError('x'); }, okGate(t));
  assert.equal(viaCheck.fast, true);
});

test('power: fast on→off — second click during «Включаю…» is queued and turns it off', async () => {
  let on = false;
  const log = [];
  let release;
  const toggle = async () => {
    const want = !on;
    log.push(want ? 'on' : 'off');
    if (want)
      await new Promise((r) => { release = r; });
    on = want;
  };
  const click = makePowerQueue(toggle);
  const first = click();
  await click(); // 1.2 s later, while still enabling
  release();
  await first;
  assert.deepEqual(log, ['on', 'off']);
  assert.equal(on, false);
  // background: «off» while the bot tab is opening waits for it instead of being dropped
  let opening = true;
  setTimeout(() => { opening = false; }, 30);
  assert.equal(await waitUntil(() => opening === false, 2000, ms => new Promise(r => setTimeout(r, ms)), 10), true);
  assert.equal(await waitUntil(() => false, 30, async () => {}, 10), false);
});

test('fixture scrub: empty <script> and on* handlers removed', () => {
  const out = scrubHtml('<script src="/a.js"></script><script></script><div onclick="steal()" onMouseOver=\'x\' data-qa="ok"><a href="javascript:void(0)">x</a></div><img onerror=go() src="/i.png">');
  assert.equal(/<script/i.test(out), false);
  assert.equal(/\son[a-z]+=/i.test(out), false);
  assert.equal(out.includes('javascript:'), false);
  assert.ok(out.includes('data-qa="ok"') && out.includes('src="/i.png"'));
});

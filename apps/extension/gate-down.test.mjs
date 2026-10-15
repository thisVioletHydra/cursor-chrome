// Dead server: the gate closes at once (≤ 3 s), the caller never waits for a re-check,
// and while it is closed no /api/queue or /api/pulse leaves the extension. 401/403 still → «unauthorized».
import { makeGateFetch } from './src/local/gate-fetch.ts';
import { checkLink, gateOpen, LINK_GATE_KEY, probeDue } from './src/local/link-gate.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const ORIGIN = 'https://admin.example';
function memArea(gate) {
  const data = { [LINK_GATE_KEY]: gate };
  return { data, get: async k => ({ [k]: data[k] }), set: async (items) => { Object.assign(data, items); } };
}

test.test('server down: gate closed within 3 s, 0 queue and 0 pulse in 60 s', async () => {
  test.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const area = memArea({ state: 'ok', host: 'admin.example', at: Date.now(), login: 'u1' });
    const hits = { queue: 0, pulse: 0 };
    const original = async (url) => {
      if (url.includes('/api/queue')) hits.queue += 1;

      if (url.includes('/api/pulse')) hits.pulse += 1;
      throw new TypeError('Failed to fetch');
    };
    const guarded = makeGateFetch(original, area, () => ORIGIN, () => Date.now());
    const t0 = Date.now();
    await assert.rejects(guarded(`${ORIGIN}/api/queue`));
    hits.queue = 0; // the request that discovered the outage
    assert.equal(gateOpen(area.data[LINK_GATE_KEY], Date.now()), false);
    assert.ok(Date.now() - t0 <= 3000);
    assert.equal(area.data[LINK_GATE_KEY].fast, true);
    assert.equal(area.data[LINK_GATE_KEY].login, 'u1');
    for (let s = 0; s < 60; s += 1) {
      const q = await guarded(`${ORIGIN}/api/queue`);
      const p = await guarded(`${ORIGIN}/api/pulse`, { method: 'POST' });
      assert.equal(q.status, 503);
      assert.equal(p.headers.get('x-cc-paused'), '1');
      test.mock.timers.tick(1000);
    }

    assert.deepEqual(hits, { queue: 0, pulse: 0 });
    // fast probe due after 2 s
    assert.equal(probeDue(area.data[LINK_GATE_KEY], area.data[LINK_GATE_KEY].at + 2000), true);
  }
  finally {
    test.mock.timers.reset();
  }
});

test.test('502/503/504 close the gate the same way; caller gets the response, not a re-check', async () => {
  for (const status of [502, 503, 504]) {
    const area = memArea({ state: 'ok', host: 'admin.example', at: Date.now() });
    let calls = 0;
    const guarded = makeGateFetch(async () => {
      calls += 1;

      return new Response('', { status });
    }, area, () => ORIGIN);
    const res = await guarded(`${ORIGIN}/api/queue`);
    assert.equal(res.status, status);
    assert.equal(calls, 1, 'no /api/link probe on the caller path');
    assert.equal(area.data[LINK_GATE_KEY].state, 'down');
  }
});

test.test('401/403 still → unauthorized', async () => {
  for (const status of [401, 403]) {
    const area = memArea({ state: 'ok', host: 'admin.example', at: Date.now() });
    await makeGateFetch(async () => new Response('', { status }), area, () => ORIGIN)(`${ORIGIN}/api/queue`);
    assert.equal(area.data[LINK_GATE_KEY].state, 'unauthorized');
  }
});

test.test('checkLink: hanging server → down within 3 s, single request', async () => {
  test.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
  try {
    let calls = 0;
    const hang = (_u, init) => {
      calls += 1;

      return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))));
    };
    const t0 = Date.now();
    const pending = checkLink(ORIGIN, 'k', hang);
    test.mock.timers.tick(3000);
    const gate = await pending;
    assert.equal(gate.state, 'down');
    assert.ok(gate.at - t0 <= 3000);
    assert.equal(calls, 1);
  }
  finally {
    test.mock.timers.reset();
  }
});

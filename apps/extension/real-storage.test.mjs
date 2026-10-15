// Real-browser style checks: a fake chrome.storage.local that fires onChanged on EVERY set (worst case), a fetch counter,
// and a service worker with realistic delays for the autopilot button.
import { paintLinkPanel } from './src/local/link-panel.ts';
import { LINK_GATE_KEY, sameGate } from './src/local/link-gate.ts';
import { watchUpdating } from './src/local/updating.ts';
import { makePowerGate } from './src/pilot/power-wish.ts';
import { makeWishSender, settlePower } from './src/pilot/power-settle.ts';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import test from 'node:test';

const sleep = ms => new Promise(done => setTimeout(done, ms));

function chromeStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = new Set();
  let writes = 0;

  return {
    data,
    writes: () => writes,
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async (items) => {
      writes += 1;
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      queueMicrotask(() => { for (const l of [...listeners]) l(changes, 'local'); });
    },
    onChanged: { addListener: l => listeners.add(l), removeListener: l => listeners.delete(l) },
  };
}

test('options storm: the OLD wiring (onChanged → check → write) on a dead server now settles after 1 request', async () => {
  const area = chromeStorage({ [LINK_GATE_KEY]: { state: 'ok', host: 's.test', at: Date.now() } });
  let link = 0;
  const dead = async (url) => {
    if (url.includes('/api/link')) link += 1;
    throw new TypeError('Failed to fetch');
  };
  // worst case: every storage change re-runs a live check (what options.ts:396 did)
  area.onChanged.addListener(() => void paintLinkPanel(null, 'https://s.test', 'k'.repeat(20), area, dead));
  await paintLinkPanel(null, 'https://s.test', 'k'.repeat(20), area, dead);
  await sleep(200);
  assert.equal(area.data[LINK_GATE_KEY].state, 'down');
  assert.ok(link <= 2, `requests: ${link}`);
  assert.ok(area.writes() <= 1, `writes: ${area.writes()}`);
});

test('sameGate: deep compare, «at» ignored except to refresh an ok gate', () => {
  const now = 1_000_000;
  assert.equal(sameGate({ state: 'down', host: 'a', at: 1 }, { state: 'down', host: 'a', at: now }, now), true);
  assert.equal(sameGate({ state: 'down', host: 'a', at: 1 }, { state: 'unauthorized', host: 'a', at: now }, now), false);
  assert.equal(sameGate({ state: 'ok', host: 'a', at: now - 1000, login: 'u' }, { state: 'ok', host: 'a', at: now, login: 'u' }, now), true);
  assert.equal(sameGate({ state: 'ok', host: 'a', at: now - 100 * 60_000 }, { state: 'ok', host: 'a', at: now }, now), false);
  assert.equal(sameGate(null, { state: 'down', host: 'a', at: now }, now), false);
});

test('watchUpdating: idempotent per node — 50 starts → one /healthz loop', async () => {
  let health = 0;
  const node = { hidden: true, className: '', textContent: '', setAttribute() {}, append() {} };
  const opts = { sleep: () => sleep(5), interval: 3000, maxWait: 9000, fetcher: async () => { health += 1; return new Response('', { status: 503 }); } };
  await Promise.all(Array.from({ length: 50 }, () => watchUpdating(node, 'https://s.test', () => {}, opts)));
  assert.equal(health, 4); // first probe + 3 pings, one loop
});

test('options/popup: onChanged reacts only to its keys; gate change paints without a request; no healthz in popup', async () => {
  const opt = await fsPromises.readFile(new URL('./src/options/options.ts', import.meta.url), 'utf8');
  const listener = opt.slice(opt.indexOf('browser.storage.onChanged.addListener((changes, area)'), opt.indexOf('setInterval('));
  assert.match(listener, /if \(UPDATE_KEY in changes\)\n {6}void drawUpdate\(\);/);
  assert.match(listener, /if \('applySyncUrl' in changes \|\| 'applySyncKey' in changes\)\n {6}void checkLinkNow\(\);/);
  assert.match(listener, /paintLinkState\(/);
  assert.doesNotMatch(listener, /paintLinkPanel\(/);
  assert.doesNotMatch(opt, /watchUpdating\(/);
  const draw = opt.slice(opt.indexOf('async function drawUpdate'), opt.indexOf('async function checkLinkNow'));
  assert.doesNotMatch(draw, /paintLinkPanel|watchUpdating|fetch/);
  const popup = await fsPromises.readFile(new URL('./src/popup/popup.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(popup, /watchUpdating\(/);
  const hooks = await fsPromises.readFile(new URL('./src/local/background-hooks.ts', import.meta.url), 'utf8');
  assert.match(hooks, /if \(checked\.state !== 'down'\)\n {8}await area\.set/);
});

test('down + open page: one shared /api/link per ~3 s → 60 s ≈ 20 requests, back within ≤ 3 s', async () => {
  // model of pingGate: ≥ 2.5 s apart, one in flight, no write while still down
  let link = 0;
  let up = false;
  let at = -Infinity;
  let inFlight = false;
  const area = chromeStorage({ [LINK_GATE_KEY]: { state: 'down', host: 's', at: 0 } });
  const ping = async (now) => {
    if (inFlight || now - at < 2500) return;
    inFlight = true;
    at = now;
    link += 1;
    if (up && area.data[LINK_GATE_KEY].state !== 'ok') await area.set({ [LINK_GATE_KEY]: { state: 'ok', host: 's', at: now } });
    inFlight = false;
  };
  let backAt = null;
  for (let t = 0; t <= 60_000; t += 3000) {
    if (t === 45_000) up = true;
    await ping(t);
    if (backAt === null && area.data[LINK_GATE_KEY].state === 'ok') backAt = t;
  }
  assert.ok(link <= 21, `requests: ${link}`);
  assert.equal(area.writes(), 1);
  assert.ok(backAt - 45_000 <= 3000);
});

// ── autopilot: popup (debounce + seq) → SW (lock + stale) with realistic delays
function swModel(area) {
  const gate = makePowerGate();
  const flags = () => area.data.flags ?? { autoQueue: false };
  const write = on => area.set({ flags: { ...flags(), autoQueue: on } });
  const enable = async (seq) => {
    const decided = await gate.locked(async () => {
      if (gate.stale(seq)) return 'stale';
      await sleep(60); // guards
      if (gate.stale(seq)) return 'stale';
      await sleep(30); // applyPilot
      await write(true);
      return 'on';
    });
    if (decided !== 'on' || gate.stale(seq)) return;
    await sleep(800); // ensurePinnedHh + pushPilot: never writes autoQueue
  };
  const disable = async () => {
    await gate.locked(async () => {
      await sleep(30);
      await write(false);
    });
    await sleep(300);
  };

  return (on, seq) => {
    if (gate.accept(seq) === false) return Promise.resolve();
    return on ? enable(seq) : disable(seq);
  };
}

async function clickBurst(clicks, gapMs) {
  const area = chromeStorage({ flags: { autoQueue: false } });
  const sw = swModel(area);
  const read = async () => area.data.flags.autoQueue === true;
  const watch = (cb) => {
    const l = (changes) => { if (changes.flags) cb(changes.flags.newValue.autoQueue === true); };
    area.onChanged.addListener(l);
    return () => area.onChanged.removeListener(l);
  };
  let shown = false;
  let settledAt = null;
  const sender = makeWishSender((on, seq) => {
    void sw(on, seq);
    void settlePower(on, read, watch).then(() => { settledAt = Date.now(); }, () => {});
  });
  for (let index = 0; index < clicks; index += 1) {
    shown = !shown; // the button shows the wish at once
    sender.wish(shown);
    await sleep(gapMs);
  }
  const lastClick = Date.now();
  await sleep(2000);

  return { want: shown, final: area.data.flags.autoQueue, settledIn: settledAt === null ? Infinity : settledAt - lastClick };
}

test('6 fast clicks → off; 5 → on; final ≤ 2 s; «off» never lost behind a slow «on»', async () => {
  for (const [n, gap] of [[6, 40], [5, 40], [2, 120], [7, 350], [4, 500]]) {
    const r = await clickBurst(n, gap);
    assert.equal(r.final, n % 2 === 1, `${n} clicks / ${gap} ms`);
    assert.equal(r.want, r.final);
    assert.ok(r.settledIn <= 2000, `settled in ${r.settledIn} ms`);
  }
});

test('SW: older seq is dropped; enable decides under the lock, «off» bypasses it', async () => {
  const gate = makePowerGate();
  assert.equal(gate.accept(10), true);
  assert.equal(gate.accept(9), false);
  assert.equal(gate.stale(9), true);
  const rpc = await fsPromises.readFile(new URL('./src/link/rpc.ts', import.meta.url), 'utf8');
  assert.match(rpc, /powerGate\.accept\(seq\) === false/);
  assert.match(rpc, /const decided = await powerGate\.locked\(\(\) => enableDecide\(patch, seq\)\);/);
  assert.match(rpc, /await markPilotStop\(\);\n  await setPilotPending\('off'\);/);
});

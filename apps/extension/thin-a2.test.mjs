// Stage A blockers: popup → connect screen on 401/lost, no /api/queue after the link is gone, badge «!»,
// admin URL scheme from the sync URL, pulse throttle, ws retry counter outside offscreen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { makeGateFetch, passesClosedGate, PAUSED_BODY } from './src/local/gate-fetch.ts';
import { adminUrl, bindMode, LINK_GATE_KEY } from './src/local/link-gate.ts';

const src = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const ORIGIN = 'https://s.example';
const mem = (gate) => { const data = { [LINK_GATE_KEY]: gate }; return { data, get: async k => ({ [k]: data[k] }), set: async items => Object.assign(data, items) }; };

test('lost link: not a single /api/queue request goes out; 401 closes the gate at once', async () => {
  const now = Date.now();
  const area = mem({ state: 'ok', host: 's.example', at: now });
  const sent = [];
  let status = 200;
  const original = async (url) => { sent.push(url); return new Response('{}', { status }); };
  const f = makeGateFetch(original, area, () => ORIGIN, () => now);
  await f(`${ORIGIN}/api/queue`);
  assert.equal(sent.length, 1);
  status = 401;
  const res = await f(`${ORIGIN}/api/queue?listen=1`);
  assert.equal(res.status, 401);
  assert.equal(area.data[LINK_GATE_KEY].state, 'unauthorized');
  assert.equal(bindMode(area.data[LINK_GATE_KEY]), true);
  for (let i = 0; i < 8; i += 1) {
    const paused = await f(`${ORIGIN}/api/queue`, { method: 'POST' });
    assert.equal(paused.status, 503);
    assert.deepEqual(await paused.json(), PAUSED_BODY);
  }
  assert.equal(sent.length, 2, 'after 401: zero further queue requests');
  // the link check itself still passes, foreign hosts are not touched
  await f(`${ORIGIN}/api/link`);
  await f('https://hh.ru/search/vacancy');
  assert.equal(sent.length, 4);
  assert.equal(passesClosedGate('/api/pulse'), false);
  assert.equal(passesClosedGate('/api/access/check'), true);
});

test('stale ok gate (TTL over) → also paused', async () => {
  const area = mem({ state: 'ok', host: 's.example', at: 0 });
  const sent = [];
  const f = makeGateFetch(async (u) => { sent.push(u); return new Response('{}'); }, area, () => ORIGIN, () => 10 * 60_000);
  assert.equal((await f(`${ORIGIN}/api/queue`)).status, 503);
  assert.equal(sent.length, 0);
});

test('popup: gate change by state → connect screen (no TTL comparison)', () => {
  const popup = src('./src/popup/popup.ts');
  assert.match(popup, /if \(bindMode\(next, Date\.now\(\), false\) && bindOn === false\)\n      paintBind\(true\);/);
  assert.doesNotMatch(popup, /gateTransition\(/);
});

test('badge follows the gate: background repaints «!» on any linkGate change; guard installed everywhere', () => {
  const hooks = src('./src/local/background-hooks.ts');
  assert.match(hooks, /if \(LINK_GATE_KEY in changes\) \{[\s\S]*?void paintGateBadge\(next\)/);
  assert.match(hooks, /installGateFetch\(area, base,/);
  assert.match(src('./src/content.ts'), /installGateFetch\(/);
  const ctl = src('./src/link/offscreen-ctl.ts');
  const body = ctl.slice(ctl.indexOf('export async function setBadge'));
  assert.ok(body.indexOf("paintBadge('!'") < body.indexOf("paintBadge('OFF'"), '«!» wins over OFF');
});

test('admin URL keeps http for localhost dev', () => {
  assert.equal(adminUrl({ state: 'down', host: 'localhost:5317', at: 0 }, 'http://localhost:5317'), 'http://localhost:5317/admin');
  assert.equal(adminUrl({ state: 'down', host: 's.example', at: 0 }, ''), 'https://s.example/admin');
  assert.equal(adminUrl({ state: 'down', host: 's.example', at: 0 }, 'http://other:1'), 'https://s.example/admin');
});

test('pulse: at most one /api/pulse per 10 s, lines joined', async () => {
  const log = src('./src/pilot/page-log.ts');
  assert.match(log, /export const PULSE_EVERY_MS = 10_000;/);
  assert.match(log, /pulseLines\.push\(line\);\n  if \(pulseTimer !== undefined\)\n    return;/);
  assert.match(log, /const wait = Math\.max\(0, pulseLastAt \+ PULSE_EVERY_MS - Date\.now\(\)\);/);
  const fn = log.slice(log.indexOf('async function postPulse'), log.indexOf('async function sendPulse'));
  assert.doesNotMatch(fn, /pilotFetch\(/, 'postPulse itself never hits the network');
});

test('ws bridge: counter lives in background, repeated enable is a no-op, no reset to 0 on re-create', () => {
  const off = src('./src/offscreen.ts');
  assert.match(off, /if \(enabled && wsEnabled\)\n    return;/);
  assert.match(off, /attempt = Math\.max\(0, fails\);\n  if \(attempt > 0\)\n    scheduleReconnect\(\);/);
  const bg = src('./src/background.ts');
  assert.match(bg, /wsFails = connected \? 0 : wsFails \+ 1;/);
  assert.match(bg, /type: 'set-ws', enabled: true, fails: wsFails/);
});

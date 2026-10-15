import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBus } from './src/lib/server/thin/cmd-bus.ts';
import { handleNext } from './src/lib/server/thin/ext-cmd-api.ts';
import { createPlanFlags } from './src/lib/server/thin/plan-flags.ts';
import { createPlanLink } from './src/lib/server/thin/plan-link.ts';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planflag-')), 'plan-flags.sqlite');
const req = (headers = {}) => new Request('https://x.test/api/ext/next', { headers: { authorization: 'Bearer t', ...headers } });
// 12:00 MSK
const NOON = Date.UTC(2026, 9, 15, 9, 0);

test('flags: default off, own table in its own file, reads never create the file', () => {
  const file = tmp();
  const flags = createPlanFlags(file);
  assert.equal(flags.enabled('thisVioletHydra'), false);
  assert.equal(fs.existsSync(file), false);
  flags.setEnabled('vasya-pupkin', true);
  assert.equal(flags.enabled('vasya-pupkin'), true);
  assert.equal(flags.enabled('thisVioletHydra'), false, 'other account untouched');
  flags.setEnabled('vasya-pupkin', false);
  assert.equal(flags.enabled('vasya-pupkin'), false);
  assert.throws(() => flags.setEnabled('../x', true));
  flags.close();
});

test('flag off → old logic (plain bus poll), planner never kicked', async () => {
  const bus = createBus({ log: () => {} });
  let built = 0;
  const link = createPlanLink({ flags: { enabled: () => false }, deps: () => { built += 1; return { settings: async () => { throw new Error('must not run'); } }; }, bus });
  assert.deepEqual(await link.onNext('roman', req(), 0), { kind: 'off', afterMs: 900000 });
  const res = await handleNext(req(), async () => 'roman', bus, 0, link);
  assert.equal(res.status, 204);
  assert.equal(link.planner.status('roman').phase, 'start');
});

test('flag on → kick: planner command reaches the extension via next, report feeds the chain', async () => {
  const bus = createBus({ log: () => {} });
  const seenHeaders = [];
  const link = createPlanLink({
    flags: { enabled: login => login === 'roman' },
    bus,
    now: () => NOON,
    deps: headersOf => ({ now: () => NOON, rand: () => 0.99, settings: async (login) => { seenHeaders.push(headersOf(login).get('x-llm-key')); return { words: [] }; } }),
  });
  const first = await handleNext(req({ 'x-llm-key': 'sk-test' }), async () => 'roman', bus, 1000, link);
  assert.equal(first.status, 200);
  const cmd = await first.json();
  assert.equal(cmd.kind, 'navigate');
  assert.match(cmd.params.url, /^https:\/\/hh\.ru\//);
  assert.equal(seenHeaders[0], 'sk-test', 'BYOK only from the request headers');
  assert.deepEqual(bus.report('roman', { id: cmd.id, ok: true, result: { url: 'https://hh.ru/search', html: '' } }), { status: 'ok' });
  const second = await handleNext(req(), async () => 'roman', bus, 1000, link);
  const next = await second.json();
  assert.equal(next.kind, 'snapshot');
  // other account: never sees roman's commands
  assert.deepEqual(await link.onNext('vasya-pupkin', req(), 0), { kind: 'off', afterMs: 900000 });
});

test('flag on, chain ends idle (out of hours) → pause answered to the extension, then held without re-kick', async () => {
  const bus = createBus({ log: () => {} });
  let settings = 0;
  const NIGHT = Date.UTC(2026, 9, 15, 21, 0); // 00:00 MSK
  const link = createPlanLink({ flags: { enabled: () => true }, bus, now: () => NIGHT, deps: () => ({ now: () => NIGHT, settings: async () => { settings += 1; return {}; } }) });
  const res = await handleNext(req(), async () => 'roman', bus, 2000, link);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'idle');
  assert.ok(body.retryMs > 60_000);
  const again = await link.onNext('roman', req(), 0);
  assert.equal(again.kind, 'pause');
  assert.equal(settings, 1, 'no new chain while the pause holds');
});

test('production deps cover every planner dependency incl. negotiations', () => {
  const src = fs.readFileSync(new URL('./src/lib/server/thin/plan-deps.ts', import.meta.url), 'utf8');
  for (const name of ['answer:', 'context:', 'recordApplied:', 'filterKnown:', 'onNegotiationRows:', 'settings:'])
    assert.ok(src.includes(name), name);
  assert.match(src, /thinAnswer\(headersOf\(login\)/);
  assert.match(src, /runTenant\(login, job\)/);
  assert.match(fs.readFileSync(new URL('./src/routes/api/ext/next/+server.ts', import.meta.url), 'utf8'), /handleNext\(request, extLogin, undefined, undefined, planLink\)/);
});

test('flag off → /api/ext/next answers 204 at once with x-next-after 15 min, no 25 s hold', async () => {
  const flags = createPlanFlags(tmp());
  const bus = createBus();
  const link = createPlanLink({ flags, deps: () => ({}), bus });
  const t0 = Date.now();
  const res = await handleNext(req(), async () => 'roman', bus, 25000, link);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('x-next-after'), '900000');
  assert.ok(Date.now() - t0 < 1000, 'not held');
  flags.close();
});

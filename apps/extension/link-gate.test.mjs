import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { checkLink, gateOpen, gateText, RELINK_TEXT, NOT_LINKED_TEXT, serverLine } from './src/local/link-gate.ts';
import { GONE_TEXT, probe, watchUpdating } from './src/local/updating.ts';

const res = (status, body = '', headers = {}) => new Response(body, { status, headers });

test('A: probe — 404/410/railway fallback/200 without ok body = gone; 503 = down', async () => {
  assert.equal(await probe('https://s', async () => res(404, 'x', { 'x-railway-fallback': 'true' })), 'gone');
  assert.equal(await probe('https://s', async () => res(410)), 'gone');
  assert.equal(await probe('https://s', async () => res(200, '<html>')), 'gone');
  assert.equal(await probe('https://s', async () => res(503)), 'down');
  assert.equal(await probe('https://s', async () => res(200, 'ok')), 'ok');
});

test('A: watchUpdating stops at once on a dead domain and gives up after the limit', async () => {
  let calls = 0;
  const node = { hidden: true, className: '', textContent: '', setAttribute() {}, append() {} };
  await watchUpdating(node, 'https://s', () => {}, { sleep: async () => {}, fetcher: async () => { calls += 1; return res(404, '', { 'x-railway-fallback': 'true' }); } });
  assert.equal(calls, 1);
  assert.equal(node.textContent, GONE_TEXT);
  calls = 0;
  const node2 = { ...node, textContent: '' };
  await watchUpdating(node2, 'https://s', () => {}, { sleep: async () => {}, interval: 3000, maxWait: 30_000, fetcher: async () => { calls += 1; return res(503); } });
  assert.equal(calls, 11);
  assert.equal(node2.textContent, GONE_TEXT);
});

test('B/C: checkLink states and gate', async () => {
  assert.equal((await checkLink('', '')).state, 'none');
  const seen = [];
  const ok = await checkLink('https://a.example/x', 'k'.repeat(20), async (url, init) => { seen.push([url, init.headers.authorization.startsWith('Bearer ')]); return res(200, '{"ok":true}'); });
  assert.deepEqual(seen, [['https://a.example/api/link', true]]);
  assert.equal(ok.host, 'a.example');
  assert.equal(gateOpen(ok, ok.at + 1000), true);
  assert.equal(gateOpen(ok, ok.at + 10 * 60_000), false);
  const unauth = await checkLink('https://a.example', 'k'.repeat(20), async () => res(401));
  assert.equal(unauth.state, 'unauthorized');
  assert.equal(gateText(unauth), RELINK_TEXT);
  const gone = await checkLink('https://old.example', 'k'.repeat(20), async () => res(404, '', { 'x-railway-fallback': 'true' }));
  assert.equal(gone.state, 'gone');
  assert.equal(gateText(null), NOT_LINKED_TEXT);
  assert.equal(serverLine(gone), 'Сервер: old.example');
  assert.equal(gateOpen(gone), false);
});

test('B: background pauses queue and search alarms behind the gate; html has panels', () => {
  const bg = fs.readFileSync(new URL('./src/background.ts', import.meta.url), 'utf8');
  assert.match(bg, /async function onQueueAlarm\(\): Promise<void> \{\n  if \(await linkPaused\(\)\)\n    return;/);
  assert.match(bg, /async function runSearchSoon\(\): Promise<void> \{\n  if \(await linkPaused\(\)\)\n    return;/);
  assert.match(fs.readFileSync(new URL('./src/popup.html', import.meta.url), 'utf8'), /id="cc-link" hidden/);
  assert.match(fs.readFileSync(new URL('./src/options.html', import.meta.url), 'utf8'), /id="link-state" hidden/);
  const gate = fs.readFileSync(new URL('./src/local/link-gate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(gate, /\.remove\(|\.clear\(|deleteDatabase/);
});

test('fix: waitHealthy exits at once on a dead domain', async () => {
  const { waitHealthy } = await import('./src/local/updating.ts');
  let calls = 0;
  const ok = await waitHealthy('https://s', { sleep: async () => {}, fetcher: async () => { calls += 1; return new Response('', { status: 404, headers: { 'x-railway-fallback': 'true' } }); } });
  assert.equal(ok, false);
  assert.equal(calls, 1);
});

test('fix: setBadge checks the gate first and puts «!» before OFF/counter', () => {
  const src = fs.readFileSync(new URL('./src/link/offscreen-ctl.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function setBadge'));
  const gate = body.indexOf('if (gateOpen(gate) === false)');
  assert.ok(gate > 0);
  assert.ok(gate < body.indexOf("text: '!'"));
  assert.ok(body.indexOf("text: '!'") < body.indexOf("text: 'OFF'"));
  assert.match(body, /setTitle\(\{ title: gateText\(gate\) \}\)/);
});

test('gate pack 2: popup/content actions, autofill and negotiations sync pause without the link', async () => {
  const { contentGateOpen, isGatedMessage, PAUSED_REPLY } = await import('./src/local/link-gate.ts');
  for (const type of ['run-apply', 'command', 'run-queue', 'sync-negotiations', 'open-hh', 'answer-question'])
    assert.equal(isGatedMessage(type), true, type);
  for (const type of ['get-sync-url', 'set-sync-url', 'get-status', 'ping', 'page-log-get'])
    assert.equal(isGatedMessage(type), false, type);
  assert.equal(PAUSED_REPLY.paused, true);
  const now = Date.now();
  assert.equal(await contentGateOpen({ get: async () => ({}) }, now), false);
  assert.equal(await contentGateOpen({ get: async () => ({ linkGate: { state: 'unauthorized', host: 'a', at: now } }) }, now), false);
  assert.equal(await contentGateOpen({ get: async () => ({ linkGate: { state: 'ok', host: 'a', at: now } }) }, now), true);
  assert.equal(await contentGateOpen({ get: async () => { throw new Error('x'); } }, now), false);
  const bg = fs.readFileSync(new URL('./src/background.ts', import.meta.url), 'utf8');
  assert.match(bg, /if \(isGatedMessage\(type\) === false\)\n    return dispatch\(\);/);
  assert.match(bg, /async function syncNegotiationsIfDue\(\): Promise<void> \{\n  if \(await linkPaused\(\)\)\n    return;/);
  const content = fs.readFileSync(new URL('./src/content.ts', import.meta.url), 'utf8');
  assert.match(content, /then\(\(open\) => \{\n  if \(open\)\n    startHhJobOnce\(\);/);
  assert.match(content, /sendResponse\(PAUSED_REPLY\)/);
});

test('gate fix 3: native commands paused; badge repainted when the link comes back', () => {
  const bg = fs.readFileSync(new URL('./src/background.ts', import.meta.url), 'utf8');
  const fn = bg.slice(bg.indexOf('async function onNativeMessage'));
  const gate = fn.indexOf('if (await linkPaused()) {');
  assert.ok(gate > 0 && gate < fn.indexOf('await runCommand('));
  assert.match(fn, /sendNative\(nativePort, \{ id: request\.id, ok: false, error: PAUSED_REPLY\.reason \}\);\n\n    return;/);
  assert.match(bg, /onGateReopen\(\(\) => setBadge\(connected\)\);/);
  const hooks = fs.readFileSync(new URL('./src/local/background-hooks.ts', import.meta.url), 'utf8');
  assert.match(hooks, /if \(reopened\)\n      await repaintBadge\(\)/);
  assert.match(hooks, /alarm\.name === LINK_ALARM\)\n      void getSyncUrl\(\)[^\n]*linkPaused\(\)/);
});

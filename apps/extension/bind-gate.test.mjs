import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { bindMark, bindMode, checkLink, contentGateOpen, gateOpen, gateTransition, isGatedMessage, markOrigins, parseConnectInput, shouldMarkPage } from './src/local/link-gate.ts';

const res = (status, body = '') => new Response(body, { status });
const KEY = 'k'.repeat(24);

test('bind: no token → bind mode, no site actions (gate closed for content and gated messages)', async () => {
  const none = await checkLink('', '');
  assert.equal(none.state, 'none');
  assert.equal(bindMode(none), true);
  assert.equal(bindMode(null, Date.now(), false), true);
  assert.equal(await contentGateOpen({ get: async () => ({}) }), false);
  assert.equal(await contentGateOpen({ get: async () => ({ linkGate: none }) }), false);
  for (const type of ['run-queue', 'run-apply', 'open-hh', 'pin-tab', 'command'])
    assert.equal(isGatedMessage(type), true, type);
});

test('bind: linked, then lost (401 / network) → transition lost, gate closed = autopilot alarms paused', async () => {
  const ok = await checkLink('https://a.example', KEY, async () => res(200, '{"login":"x"}'));
  assert.equal(bindMode(ok, ok.at), false);
  assert.equal(gateTransition(null, ok, ok.at), 'linked');
  const unauth = await checkLink('https://a.example', KEY, async () => res(401));
  assert.equal(gateTransition(ok, unauth, ok.at), 'lost');
  assert.equal(gateOpen(unauth), false);
  const down = await checkLink('https://a.example', KEY, async () => { throw new TypeError('net'); });
  assert.equal(down.state, 'down');
  assert.equal(gateTransition(ok, down, ok.at), 'lost');
  assert.equal(bindMode(down), true);
  assert.equal(gateTransition(unauth, down), null, 'no repeated events while still offline');
  const bg = fs.readFileSync(new URL('./src/background.ts', import.meta.url), 'utf8');
  assert.match(bg, /async function onQueueAlarm\(\): Promise<void> \{\n  if \(await linkPaused\(\)\)\n    return;/);
});

test('bind: connect input accepts a connect link or a bare key for the known server', () => {
  assert.deepEqual(parseConnectInput(`https://s.example/connect#${KEY}`), { url: 'https://s.example', key: KEY });
  assert.deepEqual(parseConnectInput(KEY, 'https://s.example/x'), { url: 'https://s.example', key: KEY });
  assert.equal(parseConnectInput(KEY, ''), null);
  assert.equal(parseConnectInput('https://s.example/other#x'), null);
  assert.equal(parseConnectInput('short', 'https://s.example'), null);
});

test('bind: admin mark only on our admin page, never on job sites', () => {
  const own = 'https://s.example';
  const gate = { state: 'ok', host: 's.example', at: Date.now() };
  assert.deepEqual(markOrigins(gate), [own]);
  assert.deepEqual(markOrigins(null, 'https://t.example/x'), ['https://t.example']);
  assert.deepEqual(markOrigins(null, ''), ['https://nojobnoproblem.up.railway.app']);
  assert.equal(shouldMarkPage(own, '/admin', true, markOrigins(gate)), true, 'own origin gets the mark');
  assert.equal(shouldMarkPage('https://evil.example', '/admin', true, markOrigins(gate)), false, 'foreign origin: no mark');
  assert.equal(shouldMarkPage('https://evil.example', '/admin', true, markOrigins(null)), false, 'foreign origin vs default');
  assert.equal(shouldMarkPage('https://nojobnoproblem.up.railway.app', '/admin', true, markOrigins(null)), true);
  assert.equal(shouldMarkPage(own, '/admin', false, [own]), false);
  assert.equal(shouldMarkPage(own, '/search/vacancy', true, [own]), false);
  assert.equal(bindMark(null), 'unlinked');
  assert.equal(bindMark({ state: 'ok', host: 'a', at: Date.now() }), 'linked');
});

test('bind: popup keeps version/hash, hides tabs/card/pin, content restarts job when link returns', () => {
  const popup = fs.readFileSync(new URL('./src/popup/popup.ts', import.meta.url), 'utf8');
  assert.match(popup, /tabsEl\.hidden = on;/);
  assert.match(popup, /'\.autopilot-card, \.pin-line'/);
  assert.doesNotMatch(popup.slice(popup.indexOf('function paintBind')), /build-info|#ver|build-hash/);
  assert.match(popup, /if \(bindOn\)\n    return;/);
  assert.match(popup, /'pin-here': \(\) => \{\n    if \(bindOn\)\n      return;/);
  const html = fs.readFileSync(new URL('./src/popup.html', import.meta.url), 'utf8');
  assert.match(html, /<footer class="build-info"/);
  const content = fs.readFileSync(new URL('./src/content.ts', import.meta.url), 'utf8');
  assert.match(content, /changes\[LINK_GATE_KEY\] === undefined/);
  assert.match(content, /startHhJobOnce\(\)/);
});

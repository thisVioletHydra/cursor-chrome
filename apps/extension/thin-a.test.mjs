// Stage A: no tight retry loops without the link; growing intervals; user action probes at once; 401 → relink text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { BRIDGE_STEPS_MS, makeBackoff, SERVER_STEPS_MS, stepAt } from './src/link/backoff.ts';
import { checkLink, probeDue, RELINK_TEXT, refreshGate, serverMismatch } from './src/local/link-gate.ts';
import { linkPanelParts } from './src/local/link-panel.ts';
import { watchUpdating } from './src/local/updating.ts';

const src = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const KEY = 'k'.repeat(24);
const mem = () => { const data = {}; return { data, get: async k => ({ [k]: data[k] }), set: async items => Object.assign(data, items) }; };

test('backoff grows 30 s → 15 min and never goes below the first step', () => {
  const b = makeBackoff(SERVER_STEPS_MS);
  const seen = Array.from({ length: 9 }, () => b.next());
  assert.deepEqual(seen, [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000, 900_000]);
  for (let i = 1; i < seen.length; i += 1)
    assert.ok(seen[i] >= seen[i - 1]);
  b.reset();
  assert.equal(b.next(), 30_000);
  assert.equal(stepAt(BRIDGE_STEPS_MS, 1), 2000);
  assert.equal(stepAt(BRIDGE_STEPS_MS, 99), 900_000);
  assert.ok(Math.min(...BRIDGE_STEPS_MS) >= 2000, 'local bridge never retried every second');
});

test('closed gate: background probes no more often than the growing interval; no key → no probes', async () => {
  const area = mem();
  let calls = 0;
  const down = async () => { calls += 1; throw new TypeError('net'); };
  let gate = await refreshGate(area, 'https://s.example', KEY, down, null);
  assert.equal(gate.fails, 1);
  // simulate a minute of 1-second background ticks: probe only when due
  let probes = 0;
  for (let t = 0; t <= 60_000; t += 1000) {
    if (probeDue(gate, gate.at + t))
      probes += 1;
  }
  assert.equal(probeDue(gate, gate.at + 29_000), false);
  assert.equal(probeDue(gate, gate.at + 30_000), true);
  assert.ok(probes <= 31 && probeDue(gate, gate.at + 1000) === false);
  gate = await refreshGate(area, 'https://s.example', KEY, down, gate);
  assert.equal(gate.fails, 2);
  assert.equal(probeDue(gate, gate.at + 59_000), false, 'interval grew to 1 min');
  assert.equal(probeDue(gate, gate.at + 60_000), true);
  assert.equal(probeDue({ state: 'none', host: '', at: 0 }, Date.now()), false, 'no key: nothing to probe');
  const ok = await refreshGate(area, 'https://s.example', KEY, async () => new Response('{}', { status: 200 }), gate);
  assert.equal(ok.fails, undefined, 'success resets the counter');
  assert.ok(calls >= 2);
});

test('«Подключить»: the popup checks the server right away (no wait for the schedule)', () => {
  const popup = src('./src/popup/popup.ts');
  const fn = popup.slice(popup.indexOf('async function connectFromLink'));
  const saved = fn.indexOf("type: 'set-sync-url'");
  const check = fn.indexOf('await paintLinkPanel(');
  assert.ok(saved > 0 && check > saved, 'checkLink right after saving the link');
  assert.doesNotMatch(fn.slice(saved, check), /setTimeout|sleep|probeDue/);
  const hooks = src('./src/local/background-hooks.ts');
  assert.match(hooks, /'applySyncUrl' in changes \|\| 'applySyncKey' in changes\)\n      void getSyncUrl\(\)\.then\(async url => refreshGate\(/, 'new link → immediate probe');
});

test('401 → «Переподключи расширение…»; server mismatch → same text', async () => {
  const unauth = await checkLink('https://s.example', KEY, async () => new Response('', { status: 401 }));
  assert.equal(linkPanelParts(unauth).warn, RELINK_TEXT);
  assert.equal(RELINK_TEXT, 'Переподключи расширение: вставь новую ссылку из админки');
  const ok = { state: 'ok', host: 'old.example', at: Date.now() };
  assert.equal(serverMismatch(ok, 'https://new.example'), true);
  assert.equal(linkPanelParts(ok, 'https://new.example').warn, RELINK_TEXT);
  assert.equal(linkPanelParts(ok, 'https://old.example').warn, '');
  assert.equal(linkPanelParts(ok, 'https://old.example').server, 'Сервер: old.example');
});

test('popup deploy wait grows and stops; no loop without a key', async () => {
  const pauses = [];
  const node = { hidden: true, className: '', textContent: '', setAttribute() {}, append() {} };
  await watchUpdating(node, 'https://s', () => {}, { sleep: async (ms) => { pauses.push(ms); }, steps: [3000, 6000, 12_000, 30_000, 60_000], maxWait: 120_000, fetcher: async () => new Response('', { status: 503 }) });
  assert.deepEqual(pauses.slice(0, 5), [3000, 6000, 12_000, 30_000, 60_000]);
  assert.ok(pauses.reduce((a, b) => a + b, 0) <= 120_000 + 60_000);
  assert.ok(pauses.length <= 6);
  assert.match(src('./src/popup/popup.ts'), /if \(\(await getSyncKey\(\)\)\.trim\(\)\.length > 0\)\n    void watchUpdating\(/);
});

test('no 1-second reconnect loops left: native, ws, pokes, queue rest loop gated', () => {
  const bg = src('./src/background.ts');
  assert.doesNotMatch(bg, /connectNative\(\);\n    \}, 1000\)/);
  assert.match(bg, /nativeBackoff\.next\(\)/);
  const off = src('./src/offscreen.ts');
  assert.match(off, /CONNECT_BACKOFF_MS = BRIDGE_STEPS_MS/);
  const log = src('./src/pilot/page-log.ts');
  assert.match(log, /Date\.now\(\) < pokeNextAt/);
  assert.match(log, /contentGateOpen\(/);
  const queue = src('./src/apply/queue-run.ts');
  const cycle = queue.slice(queue.indexOf('async function cycleOpen'));
  assert.ok(cycle.indexOf('contentGateOpen(') > 0 && cycle.indexOf('contentGateOpen(') < cycle.indexOf('getFlags()'));
  const ctl = src('./src/link/offscreen-ctl.ts');
  assert.match(ctl, /if \(key === lastBadge\)\n    return;/, 'badge not repainted when unchanged');
});

// Popup: «Включить/Выключить» settles on the storage confirmation (≤ 2 s), last click wins;
// server down with a saved valid link → yellow «не на связи», no key screen (popup and options).
import { makeGeneration, POWER_SETTLE_MS, settlePower } from './src/pilot/power-settle.ts';
import { DOWN_TEXT, gateText, gateView } from './src/local/link-gate.ts';
import { optionsLocked, optionsView } from './src/options/options-gate.ts';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import test from 'node:test';

const { mock } = test;

function fakeFlag(start) {
  let value = start;
  const subs = new Set();

  return {
    read: async () => value,
    subscribe: (cb) => {
      subs.add(cb);

      return () => subs.delete(cb);
    },
    write: (next) => {
      value = next;
      for (const cb of [...subs]) cb(next);
    },
    listeners: () => subs.size,
  };
}

test('settle: storage confirms at 0.5 s → final at once, not after the 8 s chain', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const flag = fakeFlag(false);
    let settled = null;
    const done = settlePower(true, flag.read, flag.subscribe).then((ok) => { settled = ok; }, () => {});
    mock.timers.tick(500);
    flag.write(true);
    await done;
    assert.equal(settled, true);
    assert.equal(flag.listeners(), 0, 'listener removed');
  }
  finally {
    mock.timers.reset();
  }
});

test('settle: no confirmation → safety timeout ~2 s', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const flag = fakeFlag(false);
    let settled = null;
    const done = settlePower(true, flag.read, flag.subscribe).then((ok) => { settled = ok; }, () => {});
    await Promise.resolve();
    mock.timers.tick(POWER_SETTLE_MS - 1);
    await Promise.resolve();
    assert.equal(settled, null);
    mock.timers.tick(1);
    await done;
    assert.equal(settled, false);
    assert.ok(POWER_SETTLE_MS <= 2000);
  }
  finally {
    mock.timers.reset();
  }
});

test('settle: already at the target → immediate', async () => {
  const flag = fakeFlag(true);
  assert.equal(await settlePower(true, flag.read, flag.subscribe, 60_000), true);
});

test('fast clicks: last click wins (older generations never paint)', () => {
  const gen = makeGeneration();
  const first = gen.next();
  const second = gen.next();
  assert.notEqual(first, gen.current());
  assert.equal(second, gen.current());
});

test('popup: no power queue; wish painted at once, debounced single send with seq; stale clicks do not paint', async () => {
  const src = await fsPromises.readFile(new URL('./src/popup/popup.ts', import.meta.url), 'utf8');
  const toggle = src.slice(src.indexOf('function togglePower()'), src.indexOf('async function runQueue'));
  assert.doesNotMatch(src, /makePowerQueue\(/);
  assert.match(toggle, /paintPower\(\); \/\/ the wanted state at once\n  wishSender\.wish\(next\);/);
  assert.match(toggle, /sendMessage\(\{ type: 'set-flags', autoQueue: next, seq \}\)/);
  assert.match(toggle, /await settlePower\(next, readAutoFlag, watchAutoFlag\)/);
  assert.match(toggle, /if \(gen !== powerGen\.current\(\)\)\n    return; \/\/ a newer click owns the button/);
});

test('gateView: key screen only for no link / 401 / gone; down and stale ok → «не на связи»', () => {
  const now = 50_000_000;
  for (const gate of [null, { state: 'none', host: '', at: now }, { state: 'unauthorized', host: 'a', at: now }, { state: 'gone', host: 'a', at: now }])
    assert.equal(gateView(gate, now), 'bind');
  assert.equal(gateView({ state: 'down', host: 'a', at: now, fails: 1, fast: true }, now), 'down');
  assert.equal(gateView({ state: 'ok', host: 'a', at: now - 10 * 60_000 }, now), 'down');
  assert.equal(gateView({ state: 'ok', host: 'a', at: now - 1000 }, now), 'open');
  assert.equal(gateText({ state: 'down', host: 'a', at: now }), DOWN_TEXT);
  assert.equal(DOWN_TEXT, 'Сервер не на связи — пауза, перепроверяю…');
});

test('options: down → locked with status, no key form', async () => {
  const now = 50_000_000;
  const down = { state: 'down', host: 'a', at: now };
  assert.equal(optionsView(down, true, now), 'down');
  assert.equal(optionsLocked(down, true, now), true);
  const src = await fsPromises.readFile(new URL('./src/options/options.ts', import.meta.url), 'utf8');
  assert.match(src, /view === 'down' \? downCard\(\) : connectCard\(\)/);
  assert.doesNotMatch(src.slice(src.indexOf('function downCard'), src.indexOf('function connectCard')), /input|parseConnectInput/);
});

test('popup: down hides the connect form and keeps the yellow status; key screen only for bind', async () => {
  const src = await fsPromises.readFile(new URL('./src/popup/popup.ts', import.meta.url), 'utf8');
  const bind = src.slice(src.indexOf('function paintBind('));
  const down = bind.slice(bind.indexOf('if (on && key === false)'), bind.indexOf('connectForm.hidden = false;'));
  assert.match(down, /connectForm\.hidden = true;/);
  assert.match(down, /paintStatus\(DOWN_TEXT\)/);
  assert.match(down, /var\(--amber\)/);
  assert.doesNotMatch(down, /BIND_TITLE/);
  assert.match(src, /paintBind\(view !== 'open', view === 'bind'\)/);
});

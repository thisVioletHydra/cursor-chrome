// options.html gate: without a valid link only the connect screen; status lines live inside the header.
import { LOCKED_HIDDEN, optionsLocked } from './src/options/options-gate.ts';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import test from 'node:test';

const now = 10_000_000;

test('locked: no gate, no key, unauthorized, gone, down', () => {
  for (const gate of [null, undefined, { state: 'none', host: '', at: now }, { state: 'unauthorized', host: 'a', at: now }, { state: 'gone', host: 'a', at: now }, { state: 'down', host: 'a', at: now }]) {
    assert.equal(optionsLocked(gate, true, now), true);
    assert.equal(optionsLocked(gate, false, now), true);
  }
});

test('open: fresh ok gate; stale ok gate locks only on the live check', () => {
  assert.equal(optionsLocked({ state: 'ok', host: 'a', at: now - 1000 }, true, now), false);
  const stale = { state: 'ok', host: 'a', at: now - 10 * 60_000 };
  assert.equal(optionsLocked(stale, false, now), false);
  assert.equal(optionsLocked(stale, true, now), true);
});

test('options.ts: lock decided before any tab is drawn; locked → no data render', async () => {
  const src = await fsPromises.readFile(new URL('./src/options/options.ts', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('async function main()'));
  assert.ok(main.indexOf('applyLock(') < main.indexOf('loadOrEmpty'));
  assert.match(main, /if \(locked === true\)\n {4}return;/);
  assert.match(src, /replaceChildren\(view === 'down' \? downCard\(\) : connectCard\(\)\)/);
  assert.deepEqual([...LOCKED_HIDDEN], ['tabs', 'status']);
});

test('options.html: link-state inside the header', async () => {
  const html = await fsPromises.readFile(new URL('./src/options.html', import.meta.url), 'utf8');
  const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
  assert.match(header, /id="link-state"/);
});

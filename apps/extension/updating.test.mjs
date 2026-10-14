import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { askServer } from './src/local/thin-answer.ts';
import { isUpdatingStatus, retryWhileUpdating, UPDATING_TEXT, waitHealthy, watchUpdating } from './src/local/updating.ts';

const nosleep = async () => {};

test('updating: 502/503/504 only', () => {
  assert.deepEqual([500, 502, 503, 504, 426, 200].map(isUpdatingStatus), [false, true, true, true, false, false]);
});

test('waitHealthy pings /healthz every 3 s until 200', async () => {
  const sleeps = [];
  const calls = [];
  let n = 0;
  const ok = await waitHealthy('https://s', { sleep: async ms => { sleeps.push(ms); }, fetcher: async (url) => { calls.push(url); n += 1; return new Response('', { status: n < 3 ? 503 : 200 }); } });
  assert.equal(ok, true);
  assert.deepEqual(sleeps, [3000, 3000, 3000]);
  assert.deepEqual(calls, ['https://s/healthz', 'https://s/healthz', 'https://s/healthz']);
  assert.equal(await waitHealthy('https://s', { sleep: nosleep, maxWait: 9000, fetcher: async () => { throw new Error('down'); } }), false);
});

test('retryWhileUpdating: 503 / network → bar on, wait healthz, repeat once, bar off; other errors untouched', async () => {
  const states = [];
  let runs = 0;
  const res = await retryWhileUpdating('https://s', async () => { runs += 1; if (runs === 1) throw new TypeError('net'); return new Response('ok'); }, { sleep: nosleep, fetcher: async () => new Response('', { status: 200 }), onUpdating: on => states.push(on) });
  assert.equal(await res.text(), 'ok');
  assert.equal(runs, 2);
  assert.deepEqual(states, [true, false]);
  runs = 0;
  const r500 = await retryWhileUpdating('https://s', async () => { runs += 1; return new Response('', { status: 500 }); }, { sleep: nosleep });
  assert.deepEqual([r500.status, runs], [500, 1]);
  runs = 0;
  const gone = await retryWhileUpdating('https://s', async () => { runs += 1; return new Response('', { status: 502 }); }, { sleep: nosleep, maxWait: 6000, fetcher: async () => new Response('', { status: 503 }) });
  assert.deepEqual([gone.status, runs], [502, 1], 'server never came back: no repeat');
});

test('askServer repeats the answer request after a deploy, never anything else', async () => {
  const urls = [];
  let n = 0;
  const fetcher = async (url) => { urls.push(url); n += 1; if (url.endsWith('/healthz')) return new Response('', { status: 200 }); return n === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify({ answers: [{ id: '0', answer: '5' }] })); };
  const out = await askServer('https://s', 'k', [{ prompt: 'x', kind: 'text', options: [] }], {}, { retry: { sleep: nosleep } }, fetcher);
  assert.deepEqual(out, [{ id: '0', answer: '5' }]);
  assert.deepEqual(urls, ['https://s/api/answer', 'https://s/healthz', 'https://s/api/answer']);
});

test('watchUpdating: bar with text while down, hidden + onBack on 200; popup/options have the slot', async () => {
  const node = { hidden: true, className: '', textContent: '', setAttribute() {} };
  const seen = [];
  let n = 0;
  let back = false;
  await watchUpdating(node, 'https://s', () => { back = true; }, { sleep: async () => { seen.push(node.textContent); }, fetcher: async () => { n += 1; return new Response('', { status: n < 3 ? 503 : 200 }); } });
  assert.equal(seen[0], UPDATING_TEXT);
  assert.equal(UPDATING_TEXT, 'Обновляемся, повторим сами…');
  assert.deepEqual([node.hidden, back], [true, true]);
  assert.match(fs.readFileSync(new URL('./src/popup.html', import.meta.url), 'utf8'), /id="cc-updating" hidden/);
  assert.match(fs.readFileSync(new URL('./src/options.html', import.meta.url), 'utf8'), /id="updating" hidden/);
});

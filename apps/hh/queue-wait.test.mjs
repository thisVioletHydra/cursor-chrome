import { coveredWaiters, isStale, splitWaiters, staleWaiters, WEEK_MS } from './src/queue/queue.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

function row(id, status) {
  return {
    id,
    company: 'Фирма',
    title: 'Frontend',
    url: `https://hh.ru/vacancy/${id}`,
    reason: 'форма',
    at: 1,
    status,
  };
}

test('only waiting rows leave, and a single id does not take the rest', () => {
  const queue = [row('1', 'needsHuman'), row('2', 'sent'), row('3', 'needsHuman'), row('4', 'pending')];
  const all = splitWaiters(queue, null);
  assert.deepEqual(all.taken.map(item => item.id), ['1', '3']);
  assert.deepEqual(all.kept.map(item => item.id), ['2', '4']);

  const one = splitWaiters(queue, ['3']);
  assert.deepEqual(one.taken.map(item => item.id), ['3']);
  assert.deepEqual(one.kept.map(item => item.id), ['1', '2', '4']);

  const sent = splitWaiters(queue, ['2']);
  assert.equal(sent.taken.length, 0);
  assert.equal(sent.kept.length, 4);
});

test('a hidden match leaves waiting, a fresh question stays', () => {
  const queue = [row('1', 'needsHuman'), row('2', 'needsHuman'), row('3', 'sent')];
  assert.deepEqual(coveredWaiters(queue, ['1', '3']), ['1']);
  assert.deepEqual(coveredWaiters(queue, []), []);
});

test('a waiter is stale after a week, a fresh one stays', () => {
  const now = 1_700_000_000_000;
  assert.equal(isStale(now - WEEK_MS, now), true);
  assert.equal(isStale(now - WEEK_MS + 1, now), false);
  const queue = [
    { ...row('1', 'needsHuman'), at: now - WEEK_MS },
    { ...row('2', 'needsHuman'), at: now - WEEK_MS, doneAt: now },
    { ...row('3', 'needsHuman'), at: now },
    { ...row('4', 'sent'), at: now - WEEK_MS * 2 },
  ];
  assert.deepEqual(staleWaiters(queue, now).map(item => item.id), ['1']);
});

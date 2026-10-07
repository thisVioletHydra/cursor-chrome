import { coveredWaiters, isStale, splitWaiters, staleWaiters } from './src/queue/queue.ts';

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
  const now = Date.parse('2026-10-08T05:19:00+06:00');
  const week = Date.parse('2026-10-01T17:14:00+06:00');
  const fresh = Date.parse('2026-10-02T04:00:00+06:00');
  assert.equal(isStale(week, now), true);
  assert.equal(isStale(fresh, now), false);
  const queue = [
    { ...row('1', 'needsHuman'), at: week },
    { ...row('2', 'needsHuman'), at: week, doneAt: now },
    { ...row('3', 'needsHuman'), at: now },
    { ...row('4', 'sent'), at: week },
  ];
  assert.deepEqual(staleWaiters(queue, now).map(item => item.id), ['1']);
});

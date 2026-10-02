import { splitWaiters } from './src/queue/queue.ts';

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

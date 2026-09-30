import { burstPages, freshWalk, stepWalk, walkFrom } from './src/mix/walk.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const words = ['Frontend', 'Vue.js', 'Node.js'];

test('the first round is one page per word', () => {
  let walk = freshWalk();
  assert.deepEqual(walk, { phase: 'cover', at: 0, left: 1 });

  walk = stepWalk(walk, words.length, 1, true, 0);
  assert.deepEqual(walk, { phase: 'cover', at: 1, left: 1 });

  walk = stepWalk(walk, words.length, 1, true, 0);
  assert.deepEqual(walk, { phase: 'cover', at: 2, left: 1 });
});

test('after the last first page the next word gets two or three pages', () => {
  const last = { phase: 'cover', at: 2, left: 1 };
  assert.equal(stepWalk(last, words.length, 1, true, 0).left, 2);
  assert.equal(stepWalk(last, words.length, 1, true, 0.5).left, 3);
  assert.equal(stepWalk(last, words.length, 1, true, 0).phase, 'deep');
  assert.equal(stepWalk(last, words.length, 1, true, 0).at, 0);
});

test('a deep word switches after its pages, then the list wraps', () => {
  const deep = stepWalk({ phase: 'deep', at: 0, left: 3 }, words.length, 3, true, 0);
  assert.deepEqual(deep, { phase: 'deep', at: 1, left: 2 });

  const wrapped = stepWalk({ phase: 'deep', at: 2, left: 2 }, words.length, 2, true, 1);
  assert.deepEqual(wrapped, { phase: 'deep', at: 0, left: 3 });
});

test('a broken page does not skip the rest of the word', () => {
  const left = stepWalk({ phase: 'deep', at: 1, left: 3 }, words.length, 1, false, 0);
  assert.deepEqual(left, { phase: 'deep', at: 1, left: 2 });
});

test('a stored walk stays on the same word', () => {
  assert.deepEqual(walkFrom({ walkPhase: 'deep', walkAt: 4, walkLeft: 2 }), { phase: 'deep', at: 4, left: 2 });
  assert.equal(burstPages('cover', 1), 1);
  assert.equal(burstPages('deep', 0), 2);
  assert.equal(burstPages('deep', 0.9), 3);
});

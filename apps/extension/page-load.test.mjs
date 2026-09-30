import { FLIP_MAX_MS, FLIP_MIN_MS, PAGE_LOAD_MS, flipWaitMs, foldLiveLine, pageLoadMiss, searchStep } from './src/search/page-load.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('a search page load times out before a minute', () => {
  assert.equal(PAGE_LOAD_MS < 60_000, true);
  assert.equal(PAGE_LOAD_MS, 45_000);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS), false);
  assert.equal(pageLoadMiss(PAGE_LOAD_MS + 1), true);
  assert.equal(pageLoadMiss(200_000), true);
});

test('a search page flips in a few seconds', () => {
  assert.equal(flipWaitMs(0), FLIP_MIN_MS);
  assert.equal(flipWaitMs(1), FLIP_MAX_MS);
  assert.equal(FLIP_MIN_MS >= 2_000, true);
  assert.equal(FLIP_MAX_MS <= 4_000, true);
  assert.equal(flipWaitMs(0.5) < 10_000, true);
});

test('seen cards open the next page until hh has no next page', () => {
  assert.equal(searchStep({ saved: 0, hasNext: true }), 'more');
  assert.equal(searchStep({ saved: 0, hasNext: false }), 'end');
  assert.equal(searchStep({ saved: 2, hasNext: true }), 'saved');
  assert.equal(searchStep({ saved: 2, hasNext: false }), 'saved');
});

test('a live wait replaces one line', () => {
  assert.deepEqual(foldLiveLine(['жду страницу, 1 с'], 'жду страницу, 2 с'), ['жду страницу, 2 с']);
  assert.deepEqual(foldLiveLine(['жду 14'], 'жду страницу, 1 с'), ['жду страницу, 1 с']);
  assert.deepEqual(foldLiveLine(['ищу вакансию'], 'ищу вакансию, 1 с'), ['ищу вакансию, 1 с']);
  assert.deepEqual(foldLiveLine(['жду страницу, 1 с'], 'жду страницу, 1 с'), ['жду страницу, 1 с']);
  assert.deepEqual(
    foldLiveLine(['уже видели, 20'], 'жду страницу, 1 с'),
    ['уже видели, 20', 'жду страницу, 1 с'],
  );
});

import { hidePhrase } from './src/diary/hide-phrase.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('a hide line names an apply, a waiter, a queue row, or a basket reason', () => {
  assert.equal(hidePhrase('sent', 'вопросы работодателя'), 'уже откликались');
  assert.equal(hidePhrase('needsHuman', 'вопросы работодателя'), 'в ждунах');
  assert.equal(hidePhrase('pending', ''), 'в очереди');
  assert.equal(hidePhrase(undefined, 'стоп-слово «php»'), 'в корзине: стоп-слово «php»');
  assert.equal(hidePhrase(undefined, 'скрыл, уже видели'), '');
  assert.equal(hidePhrase('dropped', ''), '');
});

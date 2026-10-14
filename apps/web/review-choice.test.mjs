import { sameAnswer } from './src/lib/review-choice.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const text = { kind: 'text', options: [], multi: false };
const multi = { kind: 'multi', options: ['Vue', 'React', 'TypeScript'], multi: true };
const single = { kind: 'choice', options: ['Да', 'Нет'], multi: false };

test('badge: texts compared trimmed, whitespace collapsed', () => {
  assert.equal(sameAnswer(text, '  5 лет ', '5 лет'), true);
  assert.equal(sameAnswer(text, '5  лет', '5 лет'), true);
  assert.equal(sameAnswer(text, '6', '5'), false);
});

test('badge: checkboxes compared as sets', () => {
  assert.equal(sameAnswer(multi, 'TypeScript; Vue', 'Vue; TypeScript'), true);
  assert.equal(sameAnswer(multi, 'Vue', 'Vue; TypeScript'), false);
});

test('badge: radio by label; reverting to the AI value is not a change', () => {
  assert.equal(sameAnswer(single, 'Нет', 'Да'), false);
  assert.equal(sameAnswer(single, 'Да', 'Да'), true);
});

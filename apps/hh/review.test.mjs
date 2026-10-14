import { asCapturedForm, hintQuestions, questionKey } from './src/review/form.ts';
import { parseDrafts, reasoningChain } from './src/review/draft.ts';
import { parseVacancy, topSalary } from './src/review/vacancy.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const questions = [
  { prompt: 'Сколько лет опыта с Vue?', kind: 'number', options: [], required: true, fieldKey: 'q1' },
  { prompt: 'Готовы к офису?', kind: 'choice', options: ['Да', 'Нет'], required: true, fieldKey: 'q2' },
  { prompt: 'Ваш опыт с Kotlin?', kind: 'text', options: [], required: false, fieldKey: 'q3' },
];

test('question keys ignore case, ё and punctuation', () => {
  assert.equal(questionKey('Ваш ОПЫТ с Vue.js?!'), questionKey('ваш опыт с vue js'));
  assert.equal(questionKey('Ёлка'), 'елка');
});

test('captured form is cleaned and empty forms are dropped', () => {
  assert.equal(asCapturedForm({ questions: [] }), null);
  const form = asCapturedForm({ questions: [{ prompt: '  Почему   мы? ', kind: 'weird', options: ['a', 3] }], text: 'x' });
  assert.deepEqual(form?.questions[0], { prompt: 'Почему мы?', kind: 'unknown', options: ['a'], choices: [{ value: 'a', label: 'a' }], multi: false, required: false, fieldKey: '' });
});

test('hint snippets become partial questions without the generic reason', () => {
  assert.deepEqual(hintQuestions(['вопросы работодателя', 'Расскажите о себе']).map(row => row.prompt), ['Расскажите о себе']);
});

test('drafts mark missing facts and off-list choices', () => {
  const raw = 'думаю... {"answers":[{"n":1,"answer":"7","missing":false,"why":"с 2019"},{"n":2,"answer":"Может быть","missing":false},{"n":3,"answer":"","missing":true,"why":"нет фактов про Kotlin"}]}';
  const rows = parseDrafts(raw, questions, 'test');
  assert.equal(rows[0].missing, false);
  assert.equal(rows[1].missing, true);
  assert.match(rows[1].why, /не из списка/);
  assert.equal(rows[2].missing, true);
});

test('reasoning chain puts gpt-oss first', () => {
  const chain = reasoningChain([{ id: 'mistral', model: 'mistral-small-latest', key: 'k', url: 'u' }, { id: 'groq', model: 'openai/gpt-oss-120b', key: 'k', url: 'u' }]);
  assert.equal(chain[0].id, 'groq');
});

test('hh vacancy parsing reads format, office and salary', () => {
  const info = parseVacancy('1', { name: 'Frontend', area: { name: 'Москва' }, work_format: [{ id: 'HYBRID', name: 'Гибрид' }], salary_range: { from: 200000, to: 300000, currency: 'RUR' }, description: '<p>Vue &amp; TS</p>' });
  assert.equal(info.office, true);
  assert.equal(info.format, 'Гибрид');
  assert.equal(topSalary(info), 300000);
  assert.equal(info.description, 'Vue & TS');
  assert.equal(parseVacancy('2', { schedule: { id: 'remote', name: 'Удалённая работа' } }).office, false);
});

test('answer memory and decisions round-trip in sqlite', async () => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-'));
  process.env.HH_STORE = path.join(dir, 'hh.json');
  const store = await import('./src/review/store.ts');
  await store.rememberAnswers([{ key: 'k', prompt: 'Сколько лет опыта с Vue?', answer: '7 лет' }]);
  const recalled = await store.recallAnswers(['сколько лет опыта с vue']);
  assert.equal(recalled.get(questionKey('Сколько лет опыта с Vue?')), '7 лет');
  await store.saveDecision({ id: '42', action: 'later', reason: '', answers: [], row: '', at: 1, until: 2 });
  assert.equal((await store.readDecisions()).length, 1);
  assert.equal((await store.takeDecision('42'))?.action, 'later');
  assert.equal((await store.readDecisions()).length, 0);
});

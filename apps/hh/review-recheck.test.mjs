import { closestChoice, fitChoice } from './src/review/form.ts';
import { listMemory, rememberCorrections } from './src/review/memory.ts';
import { recheckDrafts, recheckDraftsOnce } from './src/review/recheck.ts';
import { matchAnswer } from './src/review/semantic.ts';
import { readDrafts, rememberAnswers, saveDrafts, saveWaiterForm } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-recheck-')), 'hh.json');
}

const choice = (prompt, options, multi = false) => ({ prompt, kind: multi ? 'multi' : 'choice', options, choices: options.map(label => ({ value: label, label })), multi, required: false, fieldKey: '' });
const text = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const TEST = choice('Готовы выполнить тестовое задание?', ['Да', 'Нет']);
const GITHUB = 'Ссылка на GitHub с примерами кода';

test('closest option: polarity, containment, words; foreign answers still refused', () => {
  assert.equal(closestChoice(TEST, 'Только оплачиваемое'), 'Да');
  assert.equal(closestChoice(TEST, 'да'), 'Да');
  assert.equal(closestChoice(TEST, 'Нет, не готов'), 'Нет');
  assert.equal(closestChoice(choice('Формат', ['Офис', 'Удалённо']), 'Только удалённо'), 'Удалённо');
  assert.equal(closestChoice(choice('Стек', ['Vue', 'React', 'TypeScript'], true), 'vue, typescript'), 'Vue; TypeScript');
  assert.equal(closestChoice(TEST, 'Может быть'), null);
  assert.equal(fitChoice(TEST, 'Только оплачиваемое'), null, 'strict check unchanged');
});

test('root cause #1: memory text that is not an option now picks the closest option', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Только оплачиваемое' }]);
  const hit = await matchAnswer(TEST, { memory: await listMemory(), canon: [], unlinked: new Set() });
  assert.equal(hit?.answer, 'Да');
});

test('recheck: stale GitHub→stack draft is replaced or dropped, empty choice draft is filled', async () => {
  await freshStore();
  await rememberAnswers([
    { key: '', prompt: 'С какими технологиями работали?', answer: 'Vue; TypeScript' },
    { key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Только оплачиваемое' },
  ]);
  await saveWaiterForm('1', { questions: [TEST, text(GITHUB)], text: '' });
  await saveDrafts('1', [{ key: 'ссылка на github с примерами кода', prompt: GITHUB, answer: 'Vue; TypeScript', missing: false, why: '', model: 'memory', source: { kind: 'memory', target: 'm:с какими технологиями работали', from: 'С какими технологиями работали?', score: 0.75, method: 'LLM' } }]);
  const report = await recheckDrafts();
  assert.equal(report.dropped + report.updated, 1);
  assert.equal(report.filled, 1);
  const rows = (await readDrafts(['1'])).get('1');
  const github = rows.find(row => row.prompt === GITHUB);
  assert.notEqual(github?.answer, 'Vue; TypeScript');
  assert.ok(github === undefined || /https:\/\//.test(github.answer), 'only a link answer (seeded portfolio rule) may fill it');
  assert.equal(rows.find(row => row.prompt === TEST.prompt)?.answer, 'Да');
});

test('recheck runs once; reverted (unedited) answers are not saved to memory', async () => {
  await freshStore();
  assert.ok(await recheckDraftsOnce());
  assert.equal(await recheckDraftsOnce(), null);
  await rememberCorrections([{ key: '', prompt: 'Опыт с Vue', answer: '5', edited: false }]);
  assert.equal((await listMemory()).length, 0);
});

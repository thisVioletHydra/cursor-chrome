import { listCanon, listMemory, rememberCorrections, ruleFromAnswer, unlinkedFor } from './src/review/memory.ts';
import { matchAnswer } from './src/review/semantic.ts';
import { rememberAnswers } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-fix-')), 'hh.json');
}

const q = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const TEST = 'Готовы выполнить тестовое?';
const match = async prompt => matchAnswer(q(prompt), { memory: await listMemory(), canon: await listCanon(), unlinked: await unlinkedFor(prompt) });

test('edited answer on the same question replaces memory, no duplicate row', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: TEST, answer: 'Только оплачиваемое' }]);
  await rememberCorrections([{ key: '', prompt: TEST, answer: 'Да', source: 'm:x', edited: true }]);
  const rows = (await listMemory()).filter(row => row.answer === 'Да' || row.answer === 'Только оплачиваемое');
  assert.deepEqual(rows.map(row => row.answer), ['Да']);
  assert.equal((await match(TEST))?.answer, 'Да');
});

test('edit of a memory hit from a paraphrase overwrites that old memory row', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Только оплачиваемое' }]);
  const hit = await match(TEST);
  assert.equal(hit?.answer, 'Только оплачиваемое');
  await rememberCorrections([{ key: '', prompt: TEST, answer: 'Да', source: hit.source.target, edited: true }]);
  assert.ok((await listMemory()).every(row => row.answer !== 'Только оплачиваемое'));
  assert.equal((await match('Готовы выполнить тестовое задание?'))?.answer, 'Да');
});

test('edit of a canon hit beats the canon for that question only', async () => {
  await freshStore();
  const rule = await ruleFromAnswer({ prompt: TEST, answer: 'Только оплачиваемое' });
  assert.equal((await match(TEST))?.source.kind, 'canon');
  await rememberCorrections([{ key: '', prompt: TEST, answer: 'Да', source: `c:${rule.id}`, edited: true }]);
  const hit = await match(TEST);
  assert.equal(hit?.answer, 'Да');
  assert.equal(hit?.source.kind, 'memory');
});

test('unedited Ok does not unlink anything', async () => {
  await freshStore();
  const rule = await ruleFromAnswer({ prompt: TEST, answer: 'Да' });
  await rememberCorrections([{ key: '', prompt: TEST, answer: 'Да', source: `c:${rule.id}`, edited: false }]);
  assert.equal((await unlinkedFor(TEST)).size, 0);
});

test('remember as rule: replaces the old canon value instead of adding another rule', async () => {
  await freshStore();
  const before = (await listCanon()).length;
  const first = await ruleFromAnswer({ prompt: TEST, answer: 'Только оплачиваемое' });
  const second = await ruleFromAnswer({ prompt: 'готовы выполнить тестовое', answer: 'Да' });
  assert.equal(second.id, first.id);
  const canon = await listCanon();
  assert.equal(canon.length, before + 1);
  assert.equal(canon.find(item => item.id === first.id)?.answer, 'Да');
  assert.equal((await match(TEST))?.answer, 'Да');
});

test('rule overrides memory and clears an earlier unlink', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: TEST, answer: 'Только оплачиваемое' }]);
  const rule = await ruleFromAnswer({ prompt: TEST, answer: 'Да' });
  await rememberCorrections([{ key: '', prompt: TEST, answer: 'Нет', source: `c:${rule.id}`, edited: true }]);
  assert.equal((await match(TEST))?.answer, 'Нет');
  await ruleFromAnswer({ prompt: TEST, answer: 'Да', source: `c:${rule.id}` });
  const hit = await match(TEST);
  assert.equal(hit?.answer, 'Да');
  assert.equal(hit?.source.kind, 'canon');
});

test('rule from a canon hit on a new paraphrase updates that canon and adds the alias', async () => {
  await freshStore();
  const rule = await ruleFromAnswer({ prompt: TEST, answer: 'Только оплачиваемое' });
  const saved = await ruleFromAnswer({ prompt: 'Сделаете ли небольшое ТЗ?', answer: 'Да', source: `c:${rule.id}` });
  assert.equal(saved.id, rule.id);
  assert.ok(saved.aliases.includes('Сделаете ли небольшое ТЗ?'));
  assert.equal(saved.answer, 'Да');
});

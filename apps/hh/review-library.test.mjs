import { draftAnswers } from './src/review/draft.ts';
import { deleteEntry, entryToMemory, entryToRule, listCanon, listEntries, listMemory, ruleFromAnswer, unlinkLinked, unlinkedFor, updateEntry } from './src/review/memory.ts';
import { compatibleAnswer, lexicalScore, questionType } from './src/review/normalize.ts';
import { LEXICAL_MIN, matchAnswer } from './src/review/semantic.ts';
import { rememberAnswers } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-lib-')), 'hh.json');
}

const q = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const GITHUB = 'Ссылка на GitHub с примерами кода';
const match = async (prompt, judge) => matchAnswer(q(prompt), { memory: await listMemory(), canon: [], unlinked: await unlinkedFor(prompt), judge });

test('question types', () => {
  assert.equal(questionType(GITHUB), 'link');
  assert.equal(questionType('Есть ли портфолио?'), 'link');
  assert.equal(questionType('Сколько лет коммерческого опыта с Vue?'), 'number');
  assert.equal(questionType('Готовы выполнить тестовое задание?'), 'yesno');
  assert.equal(questionType('С какими технологиями работали?'), 'text');
});

test('compatibility: link question needs a link, number question needs a digit', () => {
  assert.equal(compatibleAnswer(GITHUB, 'Vue; TypeScript'), false);
  assert.equal(compatibleAnswer(GITHUB, 'https://github.com/x'), true);
  assert.equal(compatibleAnswer('Сколько лет опыта?', 'Vue'), false);
  assert.equal(compatibleAnswer('Сколько лет опыта?', '3 года'), true);
  assert.equal(compatibleAnswer('Расскажите о себе', 'что угодно'), true);
  assert.equal(compatibleAnswer('Ваши зарплатные ожидания', 'По рынку, готов обсудить'), true);
});

test('GitHub question no longer gets the tech-stack answer, even from a generous judge', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'С какими технологиями работали? (GitHub/проекты)', answer: 'Vue; TypeScript' }]);
  assert.ok(lexicalScore(GITHUB, 'С какими технологиями работали? (GitHub/проекты)') >= LEXICAL_MIN, 'words alone would match');
  assert.equal(await match(GITHUB, async (_q, texts) => texts.map(() => 0.95)), null);
  await rememberAnswers([{ key: '', prompt: 'Любимый фреймворк', answer: 'Vue' }]);
  assert.equal(await match('Какой стек предпочитаете в работе', async (_q, texts) => texts.map(() => 0.75)), null, 'judge 0.75 is below the raised bar');
  assert.equal((await match('На чём предпочитаете писать фронтенд', async (_q, texts) => texts.map(() => 0.85)))?.answer !== undefined, true, 'a confident judge still matches');
});

test('legit matches survive', async () => {
  await freshStore();
  await rememberAnswers([
    { key: '', prompt: GITHUB, answer: 'https://a.example\nhttps://b.example' },
    { key: '', prompt: 'Сколько лет опыта с Vue?', answer: '5' },
  ]);
  assert.equal((await match('Есть ли у вас портфолио?'))?.answer, 'https://a.example\nhttps://b.example');
  assert.equal((await match('Сколько лет опыта с Vue?'))?.answer, '5');
});

test('entries: memory + rules in one list with type, options, dates, match count and linked questions', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы к тестовому заданию?', answer: 'Да', kind: 'choice', options: ['Да', 'Нет'] }]);
  const chain = [{ id: 'x', name: 'X', url: 'http://mock/chat/completions', model: 'm', key: 'k' }];
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"scores":[0]}' } }] }), { status: 200 });
  try {
    await draftAnswers(chain, { id: '7', title: 't', company: 'c', info: null, questions: [q('Готовы к тестовому заданию')], formText: '', resume: '' });
  }
  finally {
    globalThis.fetch = real;
  }
  const entries = await listEntries();
  const mem = entries.find(item => item.kind === 'memory');
  assert.equal(mem.qtype, 'choice');
  assert.deepEqual(mem.options, ['Да', 'Нет']);
  assert.ok(mem.created > 0 && mem.lastUsed > 0);
  assert.equal(entries.some(item => item.kind === 'rule'), false, 'no rule seeded from code');
  assert.ok(mem.matches >= 0);
});

test('linked question list and per-item unlink', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Ваш опыт с Vue', answer: 'Пять лет' }]);
  const chain = [{ id: 'x', name: 'X', url: 'http://mock/chat/completions', model: 'm', key: 'k' }];
  await draftAnswers(chain, { id: '8', title: 't', company: 'c', info: null, questions: [q('Опыт с Vue')], formText: '', resume: '' });
  let mem = (await listEntries()).find(item => item.kind === 'memory');
  assert.equal(mem.matches, 1);
  assert.equal(mem.linked[0].prompt, 'Опыт с Vue');
  await unlinkLinked(mem.id, 'Опыт с Vue');
  mem = (await listEntries()).find(item => item.kind === 'memory');
  assert.equal(mem.matches, 0);
  assert.equal(await match('Опыт с Vue'), null);
});

test('edit, delete, memory → rule → memory without duplicates', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы выполнить тестовое?', answer: 'Только оплачиваемое' }]);
  const id = (await listEntries()).find(item => item.kind === 'memory').id;
  assert.equal(await updateEntry(id, { answer: 'Да' }), true);
  assert.equal((await listMemory())[0].answer, 'Да');
  const ruleId = await entryToRule(id);
  assert.ok(ruleId?.startsWith('c:'));
  assert.equal((await listMemory()).length, 0);
  assert.equal((await listCanon()).find(item => `c:${item.id}` === ruleId)?.answer, 'Да');
  const back = await entryToMemory(ruleId);
  assert.ok(back?.startsWith('m:'));
  assert.equal((await listCanon()).some(item => `c:${item.id}` === ruleId), false);
  assert.deepEqual((await listMemory()).map(row => row.answer), ['Да']);
  await deleteEntry(back);
  assert.equal((await listMemory()).length, 0);
});

test('rule edit via entries keeps aliases editable', async () => {
  await freshStore();
  const rule = await ruleFromAnswer({ prompt: 'Готовы к переезду?', answer: 'Нет' });
  await updateEntry(`c:${rule.id}`, { answer: 'Только удалённо', aliases: ['Готовы к переезду?', 'Рассматриваете релокацию?'] });
  const saved = (await listCanon()).find(item => item.id === rule.id);
  assert.equal(saved.answer, 'Только удалённо');
  assert.deepEqual(saved.aliases, ['Готовы к переезду?', 'Рассматриваете релокацию?']);
});

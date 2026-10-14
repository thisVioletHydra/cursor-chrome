import { draftAnswers } from './src/review/draft.ts';
import { listEntries, listMemory, rememberCorrections } from './src/review/memory.ts';
import { matchAnswer } from './src/review/semantic.ts';
import { rememberAnswers } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-human-')), 'hh.json');
}

const q = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });

test('Ok saves only manually edited fields, with origin human', async () => {
  await freshStore();
  await rememberCorrections([
    { key: '', prompt: 'Сколько лет опыта с Vue?', answer: '5', edited: false },
    { key: '', prompt: 'Готовы выполнить тестовое?', answer: 'Да', edited: true },
    { key: '', prompt: 'Расскажите о себе', answer: 'AI текст', edited: false },
  ]);
  const memory = await listMemory();
  assert.deepEqual(memory.map(row => row.prompt), ['Готовы выполнить тестовое?']);
  assert.equal(memory[0].human, true);
  assert.equal((await listEntries()).find(item => item.kind === 'memory').human, true);
});

test('untouched AI answer is never stored as human', async () => {
  await freshStore();
  await rememberCorrections([{ key: '', prompt: 'Опыт с Vue', answer: '5', source: 'm:x' }]);
  assert.equal((await listMemory()).length, 0);
});

test('human correction outranks older AI-origin memory in matching', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Только оплачиваемое' }]);
  await rememberCorrections([{ key: '', prompt: 'Готовы выполнить тестовое задание сейчас?', answer: 'Да', edited: true }]);
  const hit = await matchAnswer(q('Готовы выполнить тестовое задание?'), { memory: await listMemory(), canon: [], unlinked: new Set() });
  assert.equal(hit?.answer, 'Да');
  assert.equal(hit?.source.human, true);
});

test('human answer beats the AI model in the draft (model not asked)', async () => {
  await freshStore();
  await rememberCorrections([{ key: '', prompt: 'Готовы к тестовому заданию?', answer: 'Да', edited: true }]);
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => {
    asked += 1;

    return new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":[{"n":1,"answer":"Нет"}]}' } }] }), { status: 200 });
  };
  try {
    const chain = [{ id: 'x', name: 'X', url: 'http://mock/chat/completions', model: 'm', key: 'k' }];
    const result = await draftAnswers(chain, { id: '9', title: 't', company: 'c', info: null, questions: [q('Готовы к тестовому заданию?')], formText: '', resume: '' });
    assert.equal(result.drafts[0].answer, 'Да');
    assert.equal(result.drafts[0].source?.human, true);
    assert.equal(asked, 0);
  }
  finally {
    globalThis.fetch = real;
  }
});

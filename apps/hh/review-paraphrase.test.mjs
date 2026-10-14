import { draftAnswers } from './src/review/draft.ts';
import { listMemory, rememberCorrections } from './src/review/memory.ts';
import { lexicalScore } from './src/review/normalize.ts';
import { recheckDrafts } from './src/review/recheck.ts';
import { judgeFromChain, judgeScores, LEXICAL_MIN, matchAnswer } from './src/review/semantic.ts';
import { readDrafts, saveWaiterForm } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-para-')), 'hh.json');
}

const choice = (prompt, options, multi = false) => ({ prompt, kind: multi ? 'multi' : 'choice', options, choices: options.map(label => ({ value: label, label })), multi, required: false, fieldKey: '' });
const text = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const CHAIN = [{ id: 'groq', name: 'Groq', url: 'http://mock/chat/completions', model: 'm', key: 'k' }];

// Mock LLM: picks the remembered question whose text contains `want`, with `confidence`.
function mockLlm(want, confidence) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    calls.push(prompt);
    const list = prompt.split('Список:\n')[1]?.split('\nВерни')[0].split('\n') ?? [];
    const index = list.findIndex(line => line.includes(want));
    const content = prompt.includes('"best"') ? JSON.stringify({ best: index + 1, confidence }) : '{"answers":[]}';

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };

  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function seed() {
  await freshStore();
  await rememberCorrections([
    { key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Да', edited: true },
    { key: '', prompt: 'С какими технологиями работали?', answer: 'Vue; React; TypeScript', edited: true },
  ]);
}

test('paraphrases fall below the word threshold (why memory did not apply)', () => {
  assert.ok(lexicalScore('Готовы сделать небольшое ТЗ?', 'Готовы выполнить тестовое задание?') < LEXICAL_MIN);
  assert.ok(lexicalScore('Какой стек используете?', 'С какими технологиями работали?') < LEXICAL_MIN);
});

test('judge protocol: best + confidence → per-candidate scores', () => {
  assert.deepEqual(judgeScores({ best: 2, confidence: 0.9 }, 3), [0, 0.9, 0]);
  assert.deepEqual(judgeScores({ best: 0, confidence: 0.9 }, 2), [0, 0]);
  assert.deepEqual(judgeScores({ scores: [0.1, 0.8] }, 2), [0.1, 0.8]);
});

test('LLM fallback maps a paraphrased test-task question onto the remembered one', async () => {
  await seed();
  const llm = mockLlm('тестовое', 0.92);
  try {
    const hit = await matchAnswer(choice('Готовы сделать небольшое ТЗ?', ['Да', 'Нет']), { memory: await listMemory(), canon: [], unlinked: new Set(), judge: judgeFromChain(CHAIN) });
    assert.equal(hit?.answer, 'Да');
    assert.equal(hit?.source.method, 'LLM');
    assert.equal(hit?.source.human, true);
    assert.equal(llm.calls.length, 1);
  }
  finally {
    llm.restore();
  }
});

test('LLM fallback for technologies (checkbox), low confidence is ignored', async () => {
  await seed();
  let llm = mockLlm('технологиями', 0.88);
  try {
    const hit = await matchAnswer(choice('Какой стек используете?', ['Vue', 'React', 'Angular', 'TypeScript'], true), { memory: await listMemory(), canon: [], unlinked: new Set(), judge: judgeFromChain(CHAIN) });
    assert.equal(hit?.answer, 'Vue; React; TypeScript');
  }
  finally {
    llm.restore();
  }
  await seed();
  llm = mockLlm('технологиями', 0.6);
  try {
    assert.equal(await matchAnswer(text('Какие инструменты знаете?'), { memory: await listMemory(), canon: [], unlinked: new Set(), judge: judgeFromChain(CHAIN) }), null);
  }
  finally {
    llm.restore();
  }
});

test('LLM is not asked when words already match; type check still blocks a confident LLM', async () => {
  await seed();
  const llm = mockLlm('технологиями', 0.99);
  try {
    const exact = await matchAnswer(text('Готовы выполнить тестовое задание?'), { memory: await listMemory(), canon: [], unlinked: new Set(), judge: judgeFromChain(CHAIN) });
    assert.equal(exact?.answer, 'Да');
    assert.equal(llm.calls.length, 0);
    assert.equal(await matchAnswer(text('Ссылка на GitHub с примерами кода'), { memory: await listMemory(), canon: [], unlinked: new Set(), judge: judgeFromChain(CHAIN) }), null);
  }
  finally {
    llm.restore();
  }
});

test('draft + recheck pick up Roman answers for paraphrased questions', async () => {
  await seed();
  const llm = mockLlm('тестовое', 0.9);
  try {
    const result = await draftAnswers(CHAIN, { id: '2', title: 't', company: 'c', info: null, questions: [choice('Готовы сделать небольшое ТЗ?', ['Да', 'Нет'])], formText: '', resume: '' });
    assert.equal(result.drafts[0].answer, 'Да');
    await saveWaiterForm('3', { questions: [choice('Готовы сделать небольшое ТЗ?', ['Да', 'Нет'])], text: '' });
    const report = await recheckDrafts({ judge: judgeFromChain(CHAIN) });
    assert.ok(report.filled >= 1);
    assert.equal((await readDrafts(['3'])).get('3')?.[0]?.answer, 'Да');
  }
  finally {
    llm.restore();
  }
});

import { draftAnswers } from './src/review/draft.ts';
import { fitChoice } from './src/review/form.ts';
import { listCanon, listMemory, parseCanonSeed, saveCanon, seedCanonOnce, unlinkAnswer, unlinkedFor } from './src/review/memory.ts';
import { lexicalScore, normalizeText, stem, tokens } from './src/review/normalize.ts';
import { LEXICAL_MIN, matchAnswer } from './src/review/semantic.ts';
import { rememberAnswers } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const GITHUB = 'Ссылка на GitHub с примерами кода';
const LINKS = 'https://a.example\nhttps://b.example\nhttps://c.example';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-mem-')), 'hh.json');
}

const q = (prompt, extra = {}) => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '', ...extra });

test('normalisation: case, ё, punctuation, stopwords, stems', () => {
  assert.equal(normalizeText('Ёжик, GitHub!'), 'ежик github');
  assert.deepEqual(tokens('Укажите, пожалуйста, ваши проекты'), ['проект']);
  assert.equal(stem('примерами'), stem('примеры'));
});

test('threshold: portfolio paraphrases pass, other stacks do not', () => {
  for (const text of ['Есть ли портфолио?', 'Примеры работ', 'Ваши проекты'])
    assert.ok(lexicalScore(GITHUB, text) >= LEXICAL_MIN, text);

  assert.ok(lexicalScore('Сколько лет опыта с Vue?', 'Опыт с React?') < LEXICAL_MIN);
  assert.equal(lexicalScore(GITHUB, 'Ваши зарплатные ожидания'), 0);
  assert.ok(lexicalScore(GITHUB, 'С какими технологиями работали?') < LEXICAL_MIN, 'работали ≠ примеры работ');
});

const SEED = { key: 'seed_test_v1', items: [{ title: 'Портфолио / GitHub / примеры кода', answer: LINKS, aliases: ['портфолио', 'примеры работ', 'ваши проекты'] }] };

test('no canon in code: a fresh db is empty; the portfolio rule comes from account data, once', async () => {
  await freshStore();
  assert.equal((await listCanon()).length, 0);
  assert.equal(await seedCanonOnce(parseCanonSeed(JSON.stringify(SEED))), true);
  const canon = await listCanon();
  assert.equal(canon.length, 1);
  assert.equal(canon[0].title, 'Портфолио / GitHub / примеры кода');
  assert.equal(canon[0].answer.split('\n').length, 3);
  assert.equal(await seedCanonOnce(parseCanonSeed(SEED)), false, 'second run is a no-op');
  assert.equal(parseCanonSeed('{}'), null);
  assert.equal(parseCanonSeed(''), null);
});

test('semantic memory suggests the GitHub answer for «портфолио» and unlink sticks', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: GITHUB, answer: LINKS }]);
  const ctx = async prompt => ({ memory: await listMemory(), canon: [], unlinked: await unlinkedFor(prompt) });
  const hit = await matchAnswer(q('Есть ли у вас портфолио?'), await ctx('Есть ли у вас портфолио?'));
  assert.equal(hit?.answer, LINKS);
  assert.equal(hit?.source.from, GITHUB);
  assert.equal(hit?.source.kind, 'memory');
  await unlinkAnswer('Есть ли у вас портфолио?', hit.source.target);
  assert.equal(await matchAnswer(q('Есть ли у вас портфолио?'), await ctx('Есть ли у вас портфолио?')), null);
  assert.ok(await matchAnswer(q('Ваши проекты'), await ctx('Ваши проекты')), 'unlink is per question');
});

test('canonical answer wins over memory', async () => {
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Примеры работ', answer: 'старый ответ' }]);
  await seedCanonOnce(parseCanonSeed(SEED));
  const canon = await listCanon();
  const hit = await matchAnswer(q('Примеры работ'), { memory: await listMemory(), canon, unlinked: new Set() });
  assert.equal(hit?.source.kind, 'canon');
  await saveCanon({ id: canon[0].id, title: canon[0].title, answer: 'новые ссылки', aliases: canon[0].aliases });
  assert.equal((await listCanon())[0].answer, 'новые ссылки');
});

test('choice: memory restores the previous option, foreign answers are refused', async () => {
  const yesNo = q('Готовы к тестовому заданию?', { kind: 'choice', options: ['Да', 'Нет'], choices: [{ value: '1', label: 'Да' }, { value: '2', label: 'Нет' }] });
  assert.equal(fitChoice(yesNo, 'да'), 'Да');
  assert.equal(fitChoice(yesNo, 'Может быть'), null);
  const multi = q('Стек', { kind: 'multi', multi: true, options: ['Vue', 'React', 'Angular'] });
  assert.equal(fitChoice(multi, 'react; vue'), 'React; Vue');
  await freshStore();
  await rememberAnswers([{ key: '', prompt: 'Готовы к тестовому заданию?', answer: 'Нет' }]);
  const hit = await matchAnswer(yesNo, { memory: await listMemory(), canon: [], unlinked: new Set() });
  assert.equal(hit?.answer, 'Нет');
});

test('choice preselect from a mocked reasoning model', async () => {
  await freshStore();
  const real = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const prompt = body.messages[0].content;
    const content = prompt.includes('"scores"')
      ? '{"scores":[0]}'
      : '{"answers":[{"n":1,"answer":"Удалённо","missing":false,"why":"факты: удалёнка"},{"n":2,"answer":"Vue; TypeScript","missing":false,"why":"стек"},{"n":3,"answer":"Офис","missing":false}]}';

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const questions = [
      q('Какой формат работы?', { kind: 'choice', options: ['Офис', 'Гибрид', 'Удалённо'] }),
      q('Отметьте технологии', { kind: 'multi', multi: true, options: ['Vue', 'Python', 'TypeScript'] }),
      q('Любимый цвет?', { kind: 'choice', options: ['Синий', 'Красный'] }),
    ];
    const chain = [{ id: 'groq', name: 'Groq', url: 'http://mock/chat/completions', model: 'openai/gpt-oss-120b', key: 'k' }];
    const result = await draftAnswers(chain, { id: '1', title: 'Frontend', company: 'X', info: null, questions, formText: '', resume: '' });
    assert.equal(result.error, '');
    assert.equal(result.drafts[0].answer, 'Удалённо');
    assert.equal(result.drafts[1].answer, 'Vue; TypeScript');
    assert.equal(result.drafts[2].answer, '');
    assert.equal(result.drafts[2].missing, true);
    assert.ok(bodies.some(body => body.reasoning_effort === 'high'));
  }
  finally {
    globalThis.fetch = real;
  }
});

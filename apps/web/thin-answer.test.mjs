import { ANSWER_MIN, decide, fitType, parseContext, parseFields } from './src/lib/server/thin/answer-engine.ts';
import { byokProvider, isThinBody, thinAnswer } from './src/lib/server/thin/answer-api.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';

const PROFILE = { version: 1, savedAt: 1, custom: [], fields: { salaryNumber: { mode: 'fixed', value: '100000' }, city: { mode: 'fixed', value: 'Тестоград' } } };
const CTX = {
  profile: PROFILE,
  coverLetter: 'Тестовое письмо',
  facts: ['Стек: Vue, TypeScript.'],
  rules: [{ title: 'Ссылка на GitHub', aliases: ['портфолио'], answer: 'https://example.com/test_user' }],
  memory: [
    { prompt: 'Сколько лет опыта с Vue?', answer: '5', human: false },
    { prompt: 'Сколько лет опыта с Vue?', answer: '6', human: true },
    { prompt: 'Есть ли опыт с Nuxt?', answer: 'Да, 3 года', human: false },
  ],
};
const SECRET_KEY = 'gsk_FAKE_TEST_KEY_1234567890';
const headers = extra => new Headers({ 'content-type': 'application/json', ...extra });
const neverAsk = { complete: async () => { throw new Error('no llm'); }, askChain: async () => { throw new Error('no llm'); } };

// Log/disk interceptor: everything printed or written during fn() is captured.
async function intercept(fn) {
  const seen = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, out: process.stdout.write, err: process.stderr.write, wf: fs.writeFileSync, af: fs.appendFileSync, wp: fsPromises.writeFile, ap: fsPromises.appendFile };
  for (const name of ['log', 'info', 'warn', 'error', 'debug'])
    console[name] = (...args) => seen.push(args.map(String).join(' '));
  process.stdout.write = chunk => seen.push(String(chunk)) || true;
  process.stderr.write = chunk => seen.push(String(chunk)) || true;
  fs.writeFileSync = (file, data) => seen.push(`write ${file} ${data}`);
  fs.appendFileSync = (file, data) => seen.push(`append ${file} ${data}`);
  fsPromises.writeFile = async (file, data) => seen.push(`write ${file} ${data}`);
  fsPromises.appendFile = async (file, data) => seen.push(`append ${file} ${data}`);
  try {
    return { result: await fn(), seen };
  }
  finally {
    Object.assign(console, { log: keep.log, info: keep.info, warn: keep.warn, error: keep.error, debug: keep.debug });
    process.stdout.write = keep.out;
    process.stderr.write = keep.err;
    fs.writeFileSync = keep.wf;
    fs.appendFileSync = keep.af;
    fsPromises.writeFile = keep.wp;
    fsPromises.appendFile = keep.ap;
  }
}

test('order: rule → profile → human edit → memory', async () => {
  const ctx = parseContext(CTX);
  const fields = parseFields([
    { id: 'a', prompt: 'Ссылка на GitHub', kind: 'text' },
    { id: 'b', prompt: 'Желаемая зарплата', kind: 'number' },
    { id: 'c', prompt: 'Сколько лет опыта с Vue?', kind: 'number' },
    { id: 'd', prompt: 'Есть ли опыт с Nuxt?', kind: 'text' },
  ]);
  const { answers, order } = await thinAnswer(headers(), { fields, context: CTX }, [], neverAsk);
  assert.deepEqual(order, ['rule', 'profile', 'human', 'memory', 'llm']);
  assert.deepEqual(answers.map(row => [row.id, row.source, row.answer]), [['a', 'rule', 'https://example.com/test_user'], ['b', 'profile', '100000'], ['c', 'human', '6'], ['d', 'memory', 'Да, 3 года']]);
  assert.equal(decide(fields[2], ctx).source, 'human', 'human edit beats memory');
});

test('threshold 0.8 and type check', async () => {
  const ctx = parseContext({ memory: [{ prompt: 'Опыт работы с React Native и мобильной разработкой в команде', answer: 'Да', human: false }] });
  assert.equal(ANSWER_MIN, 0.8);
  const weak = decide(parseFields([{ id: 'x', prompt: 'Опыт работы с React?', kind: 'text' }])[0], ctx);
  assert.equal('answer' in weak, false, 'weak match is not used');
  assert.equal(fitType({ kind: 'number', options: [] }, '100 000'), '100000');
  assert.equal(fitType({ kind: 'number', options: [] }, 'по рынку'), null);
  assert.equal(fitType({ kind: 'choice', options: ['Да', 'Нет'] }, 'да'), 'Да');
  const numberFromText = await thinAnswer(headers(), { fields: [{ id: 'n', prompt: 'Сколько лет опыта с Nuxt?', kind: 'number' }], context: { memory: [{ prompt: 'Сколько лет опыта с Nuxt?', answer: 'три года', human: false }] } }, [], neverAsk);
  assert.equal(numberFromText.answers[0].human, true, 'text answer for a number field is rejected');
});

test('personal question without data → «нужен твой ответ», never the LLM', async () => {
  let asked = 0;
  const { answers } = await thinAnswer(headers({ 'x-llm-key': SECRET_KEY }), { fields: [{ id: 'p', prompt: 'Ваше гражданство?', kind: 'text' }], context: {} }, [], { complete: async () => { asked++; return '{"answer":"x"}'; }, askChain: async () => '' });
  assert.equal(answers[0].human, true);
  assert.match(answers[0].reason, /нужен твой ответ/);
  assert.equal(asked, 0);
});

test('LLM fallback: our key from env when there is no x-llm-key; answer type-checked', async () => {
  const ours = [{ id: 'groq', key: 'OUR_ENV_KEY_FAKE', model: 'm', url: 'https://example.com/v1' }];
  const used = [];
  const deps = { complete: async () => { throw new Error('byok not expected'); }, askChain: async (chain) => { used.push(chain[0].key); return '{"answer":"Да","human":false}'; } };
  const { answers, llm } = await thinAnswer(headers(), { fields: [{ id: 'q', prompt: 'Готовы работать с legacy кодом?', kind: 'choice', options: ['Да', 'Нет'] }], context: {} }, ours, deps);
  assert.equal(llm, 'ours');
  assert.deepEqual(used, ['OUR_ENV_KEY_FAKE']);
  assert.deepEqual([answers[0].source, answers[0].answer], ['llm', 'Да']);
  const none = await thinAnswer(headers(), { fields: [{ id: 'q', prompt: 'Готовы работать с legacy кодом?', kind: 'text' }], context: {} }, [], neverAsk);
  assert.equal(none.llm, 'none');
  assert.match(none.answers[0].reason, /нет ключа модели/);
});

test('BYOK: x-llm-key replaces our key for this request; never in logs, disk, output or cache', async () => {
  const ours = [{ id: 'groq', key: 'OUR_ENV_KEY_FAKE', model: 'm', url: 'https://example.com/v1' }];
  const calls = [];
  const deps = { complete: async (provider) => { calls.push(provider.key); return '{"answer":"Да","human":false}'; }, askChain: async () => { throw new Error('ours not expected'); } };
  const body = { fields: [{ id: 'q', prompt: 'Готовы к командировкам?', kind: 'text' }], context: { ...CTX, coverLetter: 'СЕКРЕТНОЕ_ПИСЬМО_ТЕСТ' } };
  const { result, seen } = await intercept(() => thinAnswer(headers({ 'x-llm-key': SECRET_KEY, 'x-llm-provider': 'groq', authorization: 'Bearer cct_FAKE_BEARER' }), body, ours, deps));
  assert.equal(result.llm, 'byok');
  assert.deepEqual(calls, [SECRET_KEY]);
  const dump = JSON.stringify(result) + seen.join('\n');
  for (const needle of [SECRET_KEY, 'cct_FAKE_BEARER', 'СЕКРЕТНОЕ_ПИСЬМО_ТЕСТ', 'Готовы к командировкам'])
    assert.equal(seen.join('\n').includes(needle), false, `not logged/written: ${needle}`);
  assert.equal(dump.includes(SECRET_KEY), false, 'key not in the response');

  // provider error echoing the key → generic reason only
  const failing = { complete: async () => { throw new Error(`401 bad key ${SECRET_KEY}`); }, askChain: async () => '' };
  const bad = await intercept(() => thinAnswer(headers({ 'x-llm-key': SECRET_KEY }), body, ours, failing));
  assert.equal(JSON.stringify(bad.result).includes(SECRET_KEY), false);
  assert.equal(bad.seen.join('\n').includes(SECRET_KEY), false);
  assert.equal(byokProvider(headers()), null);
  assert.equal(byokProvider(headers({ 'x-llm-key': 'k', 'x-llm-provider': 'custom' })), null, 'no custom url (SSRF) via header');
});

test('route: thin body detection, no logging of bodies or key headers in route/hooks', () => {
  assert.equal(isThinBody({ fields: [] }), true);
  assert.equal(isThinBody({ prompt: 'x', kind: 'text' }), false, 'legacy single question still works');
  const route = fs.readFileSync(new URL('./src/routes/api/answer/+server.ts', import.meta.url), 'utf8');
  assert.equal(/console\./.test(route), false);
  const hooks = fs.readFileSync(new URL('./src/hooks.server.ts', import.meta.url), 'utf8');
  for (const line of hooks.split('\n').filter(text => /console\./.test(text)))
    assert.equal(/body|x-llm-key|authorization|headers/i.test(line), false, line);
  for (const file of ['answer-engine.ts', 'answer-api.ts'])
    assert.equal(/console\.|writeFile|appendFile|sqlite/i.test(fs.readFileSync(new URL(`./src/lib/server/thin/${file}`, import.meta.url), 'utf8')), false, file);
});

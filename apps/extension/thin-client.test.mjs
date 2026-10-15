import { BYOK_KEY, byokInfo, loadByok, saveByok } from './src/local/byok.ts';
import { BUILTIN, CONFIG_KEY, refreshConfig, selector, validConfig } from './src/local/config-cache.ts';
import { withVersion } from './src/local/pass-header.ts';
import { askServer, contextFor } from './src/local/thin-answer.ts';
import { bannerHtml, noteUpdate, readUpdateHeaders, updateFlag } from './src/local/version.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mockArea = () => {
  const box = {};
  return { box, get: async key => ({ [key]: box[key] }), set: async (items) => { Object.assign(box, structuredClone(items)); } };
};
const memKeys = () => { let key = null;
  return { get: async () => key, put: async (k) => { key = k; } }; };
const DATA = {
  profile: { version: 1, savedAt: 1, custom: [], fields: { salaryNumber: { mode: 'fixed', value: '100000' } } },
  coverLetter: 'Тестовое письмо',
  facts: { rules: ['Стек: Vue.'], notes: '', resume: '' },
  rules: [{ title: 'Ссылка на GitHub', aliases: ['портфолио'], answer: 'https://example.com/test_user' }, { title: 'Совсем другое правило', aliases: [], answer: 'x' }],
  memory: [{ prompt: 'Сколько лет опыта с Vue?', answer: '5', human: true }, { prompt: 'Любимый цвет', answer: 'синий', human: false }],
};

test('thin answer: only near candidates go to the server, with profile/letter/facts', () => {
  const ctx = contextFor([{ prompt: 'Сколько лет опыта с Vue?', kind: 'number', options: [] }, { prompt: 'Ссылка на GitHub', kind: 'text', options: [] }], DATA, { title: 'Frontend' });
  assert.deepEqual(ctx.memory.map(row => row.prompt), ['Сколько лет опыта с Vue?']);
  assert.deepEqual(ctx.rules.map(row => row.title), ['Ссылка на GitHub']);
  assert.equal(ctx.coverLetter, 'Тестовое письмо');
  assert.deepEqual(ctx.facts, ['Стек: Vue.']);
  assert.deepEqual(contextFor([], null, {}), { vacancy: {}, formText: '' });
});

test('thin answer: headers (Bearer, x-llm-key, x-ext-version), 426 and errors → human', async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, init };
    return new Response(JSON.stringify({ answers: [{ id: '0', answer: '5', source: 'human' }] }), { status: 200 }); };
  const out = await askServer('http://s', 'ext_k', [{ prompt: 'Q', kind: 'text', options: [] }], { profile: null }, { llmKey: 'gsk_FAKE', llmProvider: 'groq', version: '0.5.1' }, ok);
  assert.equal(out[0].answer, '5');
  assert.equal(sent.url, 'http://s/api/answer');
  assert.equal(sent.init.headers['x-llm-key'], 'gsk_FAKE');
  assert.equal(sent.init.headers['x-ext-version'], '0.5.1');
  assert.equal(sent.init.headers.authorization, 'Bearer ext_k');
  assert.equal(sent.init.body.includes('gsk_FAKE'), false, 'key never in the body');
  const old = await askServer('http://s', 'k', [{ prompt: 'Q', kind: 'text', options: [] }], {}, {}, async () => new Response('{}', { status: 426 }));
  assert.match(old[0].reason, /устарело/);
  const down = await askServer('http://s', 'k', [{ prompt: 'Q', kind: 'text', options: [] }], {}, { retry: { maxWait: 0 } }, async () => { throw new Error('x'); });
  assert.equal(down[0].human, true);
  const source = fs.readFileSync(new URL('./src/hh/apply-fill.ts', import.meta.url), 'utf8');
  assert.equal(/decideWithIndex|localAnswer|decideFill/.test(source), false, 'no decision logic left in apply-fill');
  assert.equal(/\.click\(\)[^\n]*submit|submit[^\n]*\.click\(\)/i.test(source), false, 'never submits');
});

test('BYOK: encrypted at rest (AES-GCM), roundtrip, info shows only the tail', async () => {
  const area = mockArea();
  const keys = memKeys();
  await saveByok(area, keys, 'groq', 'gsk_FAKE_TEST_KEY_123456');
  const stored = JSON.stringify(area.box);
  assert.equal(stored.includes('gsk_FAKE_TEST_KEY_123456'), false);
  assert.equal(stored.includes('FAKE_TEST'), false);
  assert.deepEqual(await loadByok(area, keys), { provider: 'groq', key: 'gsk_FAKE_TEST_KEY_123456' });
  assert.deepEqual(await byokInfo(area), { on: true, provider: 'groq', tail: '3456' });
  assert.equal(await loadByok(area, memKeys()), null, 'another AES key cannot decrypt');
  await saveByok(area, keys, '', '');
  assert.equal(area.box[BYOK_KEY], null);
  const schema = await import('./src/local/schema.ts');
  assert.equal(schema.SECRET_NAME.test('llmKey') || schema.SECRET_NAME.test('apiKey'), true, 'key names are stripped from export/sync');
});

test('config cache: ETag 304, junk → last valid, server down → cache, nothing → built-in', async () => {
  const area = mockArea();
  const good = { version: 3, selectors: { letterToggle: '[data-qa="x"]' }, dictionaries: { skillJunk: ['php'] }, order: ['rule', 'profile', 'human', 'memory', 'llm'] };
  assert.equal((await refreshConfig(area, '', '1', async () => { throw new Error('no'); })).from, 'builtin');
  const first = await refreshConfig(area, 'http://s', '1', async () => new Response(JSON.stringify(good), { headers: { etag: '"e1"' } }));
  assert.equal(first.from, 'server');
  assert.equal(area.box[CONFIG_KEY].etag, '"e1"');
  let asked;
  const notModified = await refreshConfig(area, 'http://s', '1', async (url, init) => { asked = init.headers;
    return new Response(null, { status: 304 }); });
  assert.equal(asked['if-none-match'], '"e1"');
  assert.equal(asked['x-ext-version'], '1');
  assert.deepEqual([notModified.from, notModified.config.version], ['cache', 3]);
  const junk = await refreshConfig(area, 'http://s', '1', async () => new Response('{"version":"bad"}'));
  assert.deepEqual([junk.from, junk.config.version], ['cache', 3]);
  const down = await refreshConfig(area, 'http://s', '1', async () => { throw new Error('down'); });
  assert.equal(down.config.version, 3);
  assert.equal(selector(down.config, 'letterToggle'), '[data-qa="x"]');
  assert.equal(selector(down.config, 'taskQuestion'), BUILTIN.selectors.taskQuestion, 'missing selector → built-in');
  assert.equal(validConfig(null), null);
});

test('version: x-ext-version only on our /api/*, server flag → banner with the signed link', async () => {
  const h = init => new Headers(init?.headers).get('x-ext-version');
  assert.equal(h(withVersion('http://s/api/queue', {}, 'http://s', '0.5.1')), '0.5.1');
  assert.equal(withVersion('https://hh.ru/x', undefined, 'http://s', '0.5.1'), undefined);
  assert.equal(readUpdateHeaders(new Headers(), 200), null);
  const flag = readUpdateHeaders(new Headers({ 'x-ext-outdated': '1', 'x-ext-recommended': '0.6.0', 'x-ext-min': '0.0.0', 'x-ext-update-url': '/dl/abc.def' }), 200, 5);
  assert.deepEqual(flag, { outdated: true, blocked: false, recommended: '0.6.0', min: '0.0.0', url: '/dl/abc.def', at: 5 });
  assert.equal(readUpdateHeaders(new Headers(), 426).blocked, true);
  const area = mockArea();
  await noteUpdate(area, flag);
  const html = bannerHtml(await updateFlag(area), 'http://s');
  assert.match(html, /0\.6\.0/);
  assert.match(html, /href="http:\/\/s\/dl\/abc\.def"/);
  assert.equal(bannerHtml(null, 'http://s'), '');
});

import { checkIn, loadAccess, needsCheck } from './src/local/access.ts';
import { localAnswer } from './src/local/answer.ts';
import { gpuChip, hashSignals } from './src/local/fingerprint.ts';
import { emptyData, exportLocalData, parseLocalData } from './src/local/schema.ts';
import { importFromServer } from './src/local/server-import.ts';
import { createLocalStore, DATA_KEY, MEMORY_INLINE_MAX } from './src/local/store.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

// chrome.storage.local mock (JSON round-trip like the real one)
function mockArea() {
  const bag = {};

  return {
    bag,
    get: async (keys) => Object.fromEntries([keys].flat().filter(k => k in bag).map(k => [k, JSON.parse(JSON.stringify(bag[k]))])),
    set: async (items) => { for (const [k, v] of Object.entries(items)) bag[k] = JSON.parse(JSON.stringify(v)); },
  };
}

function mockBlob() {
  const bag = new Map();
  return { read: async (key = 'memory') => (bag.has(key) ? JSON.parse(JSON.stringify(bag.get(key))) : null), write: async (v, key = 'memory') => { bag.set(key, JSON.parse(JSON.stringify(v))); }, get value() { return bag.get('memory') ?? []; }, bag };
}

// Fake account in the server format (no real person's data). Secret-looking fields must be dropped.
const FAKE_ACCOUNT = {
  telegramToken: 'fake-telegram-token', modelChain: 'fake-chain', hhAccessToken: 'fake-hh', hhClientId: '', hhClientSecret: 'fake-secret', extToken: 'fake-ext-token-0000000000',
  coverLetter: 'Здравствуйте! Это тестовое сопроводительное письмо.\nhttps://example.com/cv',
  profile: JSON.stringify({ version: 1, savedAt: 1, custom: [], fields: {
    salary: { mode: 'fixed', value: 'по договорённости' },
    salaryNumber: { mode: 'fixed', value: '100000' },
    contacts: { mode: 'fixed', value: 'Telegram @test_user' },
    city: { mode: 'conditions', cases: [{ when: [{ field: 'city', op: 'is', value: 'Москва' }], value: 'Москва' }], otherwise: 'Тестоград' },
    testTask: { mode: 'fixed', value: 'да' },
  } }),
  facts: JSON.stringify({ rules: ['Город: Тестоград. Хочет удалёнку.', 'Опыт с 2020: тестовая компания, TypeScript.'], notes: 'тестовые заметки', resume: 'тестовое резюме' }),
  canonSeed: JSON.stringify({ key: 'canon_seed_test_v1', items: [
    { title: 'Портфолио / GitHub / примеры кода', aliases: ['портфолио', 'GitHub', 'ссылка на GitHub с примерами кода', 'примеры кода'], answer: 'https://example.com/portfolio' },
    { title: 'Готовы к переезду?', aliases: ['релокация'], answer: 'нет' },
  ] }),
};
const account = () => JSON.parse(JSON.stringify(FAKE_ACCOUNT));

const q = (prompt, extra = {}) => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '', ...extra });

test('server account → local data: profile, facts, canonSeed→rules, letter; keys dropped', () => {
  const raw = { ...account(), mistralApiKey: 'sk-test', openaiKey: 'x', modelChain: 'mistral:abc' };
  const parsed = parseLocalData(raw);
  assert.equal(parsed.ok, true);
  const { data, dropped } = parsed;
  assert.equal(data.profile.fields.salaryNumber.value, '100000');
  assert.ok(data.facts.rules.length > 0);
  assert.ok(data.rules.length > 0 && data.rules.length === data.canonSeed.items.length);
  assert.ok(data.coverLetter.length > 0);
  for (const name of ['mistralApiKey', 'openaiKey', 'modelChain', 'extToken', 'telegramToken', 'hhClientSecret', 'hhAccessToken'])
    assert.ok(dropped.includes(name), name);
  const text = JSON.stringify(data);
  assert.equal(/sk-test|extToken|telegramToken|hhClientSecret|modelChain/.test(text), false);
});

test('export: versioned schema, whitelist only, never a key; import ignores keys', () => {
  const data = { ...parseLocalData(account()).data, apiKey: 'sk-leak' };
  data.profile.fields.mistralApiKey = { mode: 'fixed', value: 'sk-nested' };
  const file = exportLocalData(data);
  const back = JSON.parse(file);
  assert.equal(back.schema, 'cursor-chrome/local-data');
  assert.equal(back.version, 1);
  assert.equal(/sk-leak|sk-nested|apiKey|ApiKey/.test(file), false);
  const tampered = parseLocalData({ ...back, groqKey: 'gsk_1', memory: [{ prompt: 'Опыт с Vue?', answer: '5 лет', token: 'x' }] });
  assert.equal(tampered.ok, true);
  assert.deepEqual(tampered.dropped, ['groqKey']);
  assert.equal(JSON.stringify(tampered.data).includes('gsk_1'), false);
  assert.equal(tampered.data.memory[0].token, undefined);
});

test('import validation rejects wrong schema / version / non-object', () => {
  assert.equal(parseLocalData('not json').ok, false);
  assert.equal(parseLocalData([1, 2]).ok, false);
  assert.equal(parseLocalData({ schema: 'other' }).ok, false);
  assert.equal(parseLocalData({ schema: 'cursor-chrome/local-data', version: 99 }).ok, false);
});

test('store: chrome.storage round-trip, big memory goes to IndexedDB blob', async () => {
  const area = mockArea();
  const blob = mockBlob();
  const store = createLocalStore(area, blob);
  assert.equal(await store.initialized(), false);
  const data = parseLocalData(account()).data;
  await store.save(data);
  assert.equal((await store.load()).profile.fields.contacts.value, 'Telegram @test_user');
  const big = Array.from({ length: 4000 }, (_, i) => ({ key: `k${i}`, prompt: `Вопрос номер ${i} про опыт`, answer: 'x'.repeat(300) }));
  assert.ok(JSON.stringify(big).length > MEMORY_INLINE_MAX);
  await store.save({ ...data, memory: big });
  assert.equal(area.bag[DATA_KEY].memory.where, 'split');
  assert.equal(blob.value.length, 4000);
  assert.equal((await store.load()).memory.length, 4000);
});

test('first-run server import fills an empty store and never overwrites local data', async () => {
  const area = mockArea();
  const store = createLocalStore(area);
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return { ok: true, status: 200, json: async () => ({ ...account(), mistralApiKey: 'sk-x' }) }; };
  assert.equal((await importFromServer(store, 'http://s', 'k1', fetcher)).done, true);
  assert.equal(calls[0].url, 'http://s/api/account-data');
  await store.update(d => ({ ...d, coverLetter: 'мой локальный текст' }));
  assert.equal((await importFromServer(store, 'http://s', 'k1', fetcher)).done, false);
  assert.equal((await store.load()).coverLetter, 'мой локальный текст');
  assert.equal(JSON.stringify(area.bag).includes('sk-x'), false);
});

test('answers come from local data: rule → profile → human → memory; personal never to LLM', () => {
  const data = parseLocalData(account()).data;
  data.memory = [
    { key: 'a', prompt: 'Сколько лет опыта с Vue?', answer: '3 года' },
    { key: 'b', prompt: 'Сколько лет опыта с Vue?', answer: '5 лет', human: true },
  ];
  const rule = localAnswer(q('Ссылка на GitHub с примерами кода'), data);
  assert.equal(rule.kind, 'answer'); assert.equal(rule.source, 'rule'); assert.match(rule.answer, /example\.com\/portfolio/);
  const pay = localAnswer(q('Укажите сумму зарплатных ожиданий цифрами'), data);
  assert.equal(pay.source, 'profile'); assert.equal(pay.answer, '100000');
  const city = localAnswer(q('В каком городе вы проживаете?'), data, { city: 'Москва' });
  assert.equal(city.answer, 'Москва');
  assert.equal(localAnswer(q('В каком городе вы проживаете?'), data, { city: 'Казань' }).answer, 'Тестоград');
  const vue = localAnswer(q('Сколько лет опыта с Vue?'), data);
  assert.equal(vue.source, 'human'); assert.equal(vue.answer, '5 лет');
  const empty = emptyData();
  assert.equal(localAnswer(q('Ваше гражданство?'), empty).kind, 'need-human');
  assert.equal(localAnswer(q('Опишите самый интересный проект'), empty).kind, 'ask-model');
  // edit in local data changes the answer
  data.profile.fields.salaryNumber = { mode: 'fixed', value: '300000' };
  assert.equal(localAnswer(q('Укажите сумму зарплатных ожиданий цифрами'), data).answer, '300000');
});

test('fingerprint: gpu compared by chip, hashes only in the request body', async () => {
  assert.equal(gpuChip('ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'nvidia rtx 4050');
  assert.equal(gpuChip('ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028E1) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5222)'), 'nvidia rtx 4050');
  assert.equal(gpuChip('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)'), 'apple m2 pro');
  const raw = { deviceId: 'dev-1', gpu: 'nvidia rtx 4050', os: 'macOS', fonts: 'Arial', screen: '1920x1080@2', cores: '8', memory: '8', timezone: 'Asia/Bishkek', language: 'ru-RU' };
  const area = mockArea();
  const state = await loadAccess(area);
  assert.match(state.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal((await loadAccess(area)).deviceId, state.deviceId);
  await area.set({ 'access:v1': { ...state, token: 'cct_secret' } });
  assert.equal(needsCheck(await loadAccess(area)), true);
  let sent;
  const fetcher = async (url, init) => { sent = init; return { status: 200, json: async () => ({ pass: 'ccp_1', passExpires: Date.now() + 4 * 3600e3, score: 10, zone: 'match', slot: 1, reason: 'ok' }) }; };
  const after = await checkIn(area, 'http://s', raw, fetcher);
  assert.equal(after.pass, 'ccp_1');
  assert.equal(needsCheck(after), false);
  assert.equal(sent.body.includes('cct_secret'), false);
  assert.equal(sent.body.includes('Asia/Bishkek'), false);
  assert.deepEqual(JSON.parse(sent.body).signals, await hashSignals(raw));
});

test('apply-fill decision: local first, personal without data → нужен твой ответ, else cloud; no data → legacy cloud', async () => {
  const { decideFill } = await import('./src/local/fill-decision.ts');
  const data = parseLocalData(account()).data;
  const fq = (prompt, kind = 'text', options = []) => ({ prompt, kind, options });
  assert.equal(decideFill(fq('Укажите сумму зарплатных ожиданий цифрами', 'number'), data).answer, '100000');
  assert.equal(decideFill(fq('Готовы выполнить тестовое задание?', 'choice', ['Да', 'Нет']), data).answer, 'Да');
  const empty = emptyData();
  const human = decideFill(fq('Ваше гражданство?'), empty);
  assert.equal(human.use, 'human'); assert.match(human.reason, /нужен твой ответ/);
  assert.equal(decideFill(fq('Опишите самый интересный проект'), empty).use, 'cloud');
  assert.equal(decideFill(fq('Ваше гражданство?'), null).use, 'cloud');
});

test('pass header: only our /api/* (not /api/access/*), only with a pass', async () => {
  const { withPass } = await import('./src/local/pass-header.ts');
  const h = init => new Headers(init?.headers).get('x-access-pass');
  assert.equal(h(withPass('http://s/api/queue', { headers: { authorization: 'Bearer k' } }, 'http://s', 'ccp_1')), 'ccp_1');
  assert.equal(withPass('http://s/api/access/check', undefined, 'http://s', 'ccp_1'), undefined);
  assert.equal(withPass('https://hh.ru/api/x', undefined, 'http://s', 'ccp_1'), undefined);
  assert.equal(withPass('http://s/api/queue', undefined, 'http://s', ''), undefined);
});

const bigMemory = (n = 4000) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, prompt: `Служебная запись xq${i}`, answer: i % 2 ? `коротко ${i}` : `${'длинный ответ '.repeat(30)}#${i}` }));

test('migration v1-inline → v2-split: no loss, backup, idempotent', async () => {
  const { INDEX_KEY } = await import('./src/local/store.ts');
  const area = mockArea();
  const blob = mockBlob();
  const data = { ...parseLocalData(account()).data, memory: bigMemory(500) };
  await createLocalStore(area).save(data); // legacy: everything inline
  const store = createLocalStore(area, blob);
  assert.equal((await store.layout()).schema, 'v1-inline');
  const report = await store.migrate(111);
  assert.deepEqual([report.from, report.to, report.rows], ['v1-inline', 'v2-split', 500]);
  assert.ok(area.bag['localData:backup:111']);
  assert.equal(blob.bag.get('backup-111').length, 500);
  const after = await store.load();
  assert.deepEqual(after.memory, data.memory);
  assert.deepEqual(after.profile, data.profile);
  assert.equal(after.coverLetter, data.coverLetter);
  assert.equal(area.bag[INDEX_KEY].length, 500);
  assert.equal(Array.isArray(area.bag[DATA_KEY].memory), false);
  const again = await store.migrate(222);
  assert.equal(again.backup, null); assert.equal(again.to, 'v2-split');
  assert.deepEqual((await store.load()).memory, data.memory);
});

test('migration v1-idb (old big format) → v2-split: no loss', async () => {
  const area = mockArea();
  const blob = mockBlob();
  const memory = bigMemory(3000);
  const small = parseLocalData(account()).data;
  await blob.write(memory, 'memory');
  await area.set({ [DATA_KEY]: { ...small, memory: { where: 'idb', count: memory.length } } });
  const store = createLocalStore(area, blob);
  assert.equal((await store.layout()).schema, 'v1-idb');
  const report = await store.migrate(5);
  assert.equal(report.to, 'v2-split'); assert.equal(report.rows, 3000);
  assert.deepEqual((await store.load()).memory, memory);
  assert.equal(blob.bag.get('backup-5').length, 3000);
});

test('memory > 1 MB: apply-fill finds answers by index and via IndexedDB (background)', async () => {
  const { decideFill, decideWithIndex } = await import('./src/local/fill-decision.ts');
  const area = mockArea();
  const blob = mockBlob();
  const memory = [...bigMemory(4000), { key: 'vue', prompt: 'Сколько лет опыта с Vue?', answer: '5 лет', human: true }, { key: 'about', prompt: 'Опишите ваш подход к код-ревью', answer: `Смотрю сначала архитектуру. ${'Подробности. '.repeat(40)}` }];
  assert.ok(JSON.stringify(memory).length > MEMORY_INLINE_MAX);
  const full = createLocalStore(area, blob); // background / extension page
  await full.save({ ...parseLocalData(account()).data, memory });
  assert.ok(JSON.stringify(area.bag).length < MEMORY_INLINE_MAX, 'storage.local keeps only the light part');
  const content = createLocalStore(area); // content script: no IndexedDB
  const indexed = await content.loadIndexed();
  assert.equal(indexed.hasLong, true);
  let asked = 0;
  const askFull = async (q, v) => { asked++; return decideFill(q, await full.load(), v); };
  const short = await decideWithIndex({ prompt: 'Сколько лет опыта с Vue?', kind: 'text', options: [] }, indexed, {}, askFull);
  assert.equal(short.via, 'index'); assert.equal(short.answer, '5 лет'); assert.equal(asked, 0);
  const long = await decideWithIndex({ prompt: 'Опишите ваш подход к код-ревью', kind: 'text', options: [] }, indexed, {}, askFull);
  assert.equal(long.via, 'idb'); assert.match(long.answer, /^Смотрю сначала/); assert.equal(asked, 1);
  const none = await decideWithIndex({ prompt: 'Ваше гражданство?', kind: 'text', options: [] }, indexed, {}, askFull);
  assert.equal(none.use, 'human');
});

test('export / import with the split schema: same data, no keys', async () => {
  const area = mockArea();
  const blob = mockBlob();
  const store = createLocalStore(area, blob);
  const memory = bigMemory(3000);
  await store.save({ ...parseLocalData(account()).data, memory });
  const file = exportLocalData(await store.load());
  assert.equal(/extToken|apiKey|modelChain|memIndex/.test(file), false);
  const back = parseLocalData(file);
  assert.equal(back.ok, true);
  const other = createLocalStore(mockArea(), mockBlob());
  await other.save(back.data);
  assert.deepEqual((await other.load()).memory, memory);
  assert.equal((await other.layout()).schema, 'v2-split');
});

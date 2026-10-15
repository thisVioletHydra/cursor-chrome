// Server planner transit: body build + limits + no secrets, chain POST/GET, x-ext-tab, report lost, config v2 seed.
import { buildTransit, TRANSIT_LIMITS as L, tabHeader, transitBody } from './src/link/transit-context.ts';
import { serverLinkLoop } from './src/link/server-link.ts';
import { syncExtConfig } from './src/pilot/ext-config-sync.ts';
import { EXT_CONFIG_KEY, EXT_SEED_KEY } from './src/pilot/ext-settings.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const big = (n, ch = 'а') => ch.repeat(n);
function data(over = {}) {
  return {
    schema: 'cursor-chrome/local-data',
    version: 1,
    savedAt: 1,
    profile: { version: 1, savedAt: 1, fields: { city: { value: 'Бишкек' } }, custom: [], apiKey: 'sk-should-never-leave-1234567890' },
    facts: { rules: ['Только удалёнка'], notes: 'Заметка 1\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx', resume: '' },
    canonSeed: { key: 'k', items: [{ title: 'Зарплата', answer: '300k', aliases: ['ЗП'] }] },
    rules: [{ id: 1, title: 'Город', answer: 'Бишкек', aliases: ['город проживания'] }],
    memory: [{ key: 'a', prompt: 'Опыт?', answer: '5 лет' }, { key: 'b', prompt: 'Английский?', answer: 'B2', human: true }],
    coverLetter: '',
    ...over,
  };
}

test('body: all parts, facts from LocalData.facts, human memory first', () => {
  const { context } = buildTransit(data(), 'Здравствуйте');
  assert.equal(context.letter, 'Здравствуйте');
  assert.deepEqual(context.canon.map(r => r.title), ['Город', 'Зарплата']);
  assert.equal(context.memory[0].human, true);
  assert.ok(context.facts.includes('Только удалёнка'));
  assert.ok(context.facts.includes('Заметка 1'));
  assert.equal(context.profile.fields.city.value, 'Бишкек');
});

test('no secrets: secret-named props and key-looking values never leave', () => {
  const text = transitBody(buildTransit(data(), 'ключ sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA').context);
  assert.doesNotMatch(text, /sk-should|sk-abcdef|sk-proj|apiKey|OPENAI_API_KEY/);
});

test('empty store: valid empty context (chain still starts)', () => {
  const { context } = buildTransit(null, '');
  assert.deepEqual(context, { profile: null, letter: '', canon: [], memory: [], facts: [] });
});

test('limits: every field cut under the server limits, body ≤ 64 KB', () => {
  const rules = Array.from({ length: 400 }, (_, index) => ({ id: index, title: `t${index}${big(2500)}`, answer: big(2500), aliases: Array.from({ length: 30 }, () => big(600)) }));
  const memory = Array.from({ length: 700 }, (_, index) => ({ key: String(index), prompt: `p${index}${big(600)}`, answer: big(3000) }));
  const facts = { rules: Array.from({ length: 300 }, (_, index) => `f${index}${big(700)}`), notes: '', resume: '' };
  const profile = { version: 1, savedAt: 1, fields: { blob: { value: big(40_000) } }, custom: [] };
  const { context, trimmed } = buildTransit(data({ rules, memory, facts, profile }), big(12_000));
  assert.equal(context.profile, null);
  assert.ok(context.letter.length <= L.letter);
  assert.ok(context.canon.length <= L.canon && context.canon.every(r => r.title.length <= 2000 && r.answer.length <= 2000 && r.aliases.length <= 20 && r.aliases.every(a => a.length <= 500)));
  assert.ok(context.memory.length <= L.memory && context.memory.every(m => m.prompt.length <= 500 && m.answer.length <= 2000));
  assert.ok(context.facts.length <= L.facts && context.facts.every(f => f.length <= 500));
  assert.ok(new TextEncoder().encode(transitBody(context)).length <= L.bodyBytes);
  assert.ok(trimmed.length > 0);
});

test('x-ext-tab: [\\w:.-] only, ≤ 100', () => {
  assert.equal(tabHeader('tab:42'), 'tab:42');
  assert.equal(tabHeader(`tab 4/2${'x'.repeat(200)}`).length, 100);
  assert.match(tabHeader('a b/c?d'), /^[\w:.-]+$/);
});

function rig(responses, over = {}) {
  const calls = [];
  const execs = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const next = responses.shift();

    return typeof next === 'function' ? next() : next ?? new Response(null, { status: 204 });
  };
  const deps = { base: async () => 'https://admin.test', key: async () => 'tok', gateOpen: async () => true, fetcher, sleep: async () => {}, now: () => 0,
    exec: async (cmd) => {
      execs.push(cmd.id);

      return { ok: true, result: null };
    },
    context: async () => '{"context":{"profile":null,"letter":"","canon":[],"memory":[],"facts":[]}}', tabId: async () => 'tab:7', ...over };

  return { calls, execs, deps };
}
const cmd = id => json({ id, kind: 'click', params: { selector: '#a' } });

test('chain: POST with context first, GET inside, POST again after idle/stop; x-ext-tab on every poll', async () => {
  const r = rig([cmd('c1'), json({ ok: true }), new Response(null, { status: 204 }), json({ type: 'idle', retryMs: 1000 }), json({ type: 'stop', reason: 'x' }), new Response(null, { status: 204 })], { maxRounds: 5 });
  await serverLinkLoop(r.deps);
  const polls = r.calls.filter(c => c.url.endsWith('/api/ext/next'));
  assert.deepEqual(polls.map(c => c.method), ['POST', 'GET', 'GET', 'POST', 'POST']);
  assert.equal(polls[0].headers['content-type'], 'application/json');
  assert.match(polls[0].body, /"context"/);
  assert.ok(polls.every(c => c.headers['x-ext-tab'] === 'tab:7'));
  assert.equal(polls[1].body, undefined);
});

test('no context provider (old bus): plain GET only', async () => {
  const r = rig([], { context: undefined, maxRounds: 2 });
  await serverLinkLoop(r.deps);
  assert.ok(r.calls.every(c => c.method === 'GET'));
});

test('report {ok:true, lost:true}: same id is never executed again', async () => {
  const lostIds = [];
  const r = rig([cmd('c9'), json({ ok: true, lost: true }), cmd('c9'), json({ ok: true })], { maxRounds: 2, onLost: async (id) => { lostIds.push(id); } });
  await serverLinkLoop(r.deps);
  assert.deepEqual(r.execs, ['c9']);
  assert.deepEqual(lostIds, ['c9']);
  const second = JSON.parse(r.calls.filter(c => c.url.endsWith('/api/ext/report'))[1].body);
  assert.equal(second.ok, false);
});

test('config v2: settings:null → keep local + seed once; serverPlanner top-level cached; ETag sent', async () => {
  const store = { flags: { hideJunk: true, keepSession: false } };
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    if (url.endsWith('/seed'))
      return json({ ok: true, seeded: true });

    return json({ version: 2, selectors: {}, dictionaries: {}, order: [], serverPlanner: true, settings: calls.length > 2 ? { hideJunk: true, keepSession: false } : null }, 200, { etag: `"e${calls.length}"` });
  };
  const d = { base: async () => 'https://admin.test', key: async () => 'tok', gateOpen: async () => true, fetcher, now: () => 5, get: async keys => Object.fromEntries(keys.map(k => [k, store[k]])), set: async (items) => { Object.assign(store, items); } };
  assert.equal(await syncExtConfig(d), 'seeded');
  assert.deepEqual(JSON.parse(calls.find(c => c.url.endsWith('/seed')).body), { hideJunk: true, keepSession: false });
  assert.equal(store[EXT_SEED_KEY], true);
  assert.equal(store[EXT_CONFIG_KEY].serverPlanner, true);
  assert.equal(store.flags.hideJunk, true); // local values untouched
  const etag = store[EXT_CONFIG_KEY].etag;
  assert.ok(etag);
  calls.length = 0;
  await syncExtConfig(d);
  assert.equal(calls[0].headers['if-none-match'], etag);
  assert.equal(calls.some(c => c.url.endsWith('/seed')), false);
});

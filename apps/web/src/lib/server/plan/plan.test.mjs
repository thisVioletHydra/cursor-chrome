import { createStore, createPlanner, advance } from './index.ts';
import { freshState } from './state.ts';
import { hoursOpen, msToOpen, pageSignal, teaRoll, titleStop, readWait, PACE_DEFAULT } from './rules.ts';
import { parseSerp } from './search.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

// 12:00 MSK = 09:00 UTC
const NOON = Date.UTC(2026, 9, 15, 9, 0);
const card = (id, title) => `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}"><span data-qa="serp-item__title">${title}</span></a><span data-qa="vacancy-serp__vacancy-employer">Co${id}</span></div>`;
const SERP = card('101', 'Frontend Svelte') + card('102', 'PHP Bitrix dev') + card('103', 'Node backend');

// Fake extension: answers per command kind; records everything.
function fakeExt(over = {}) {
  const log = [];
  let url = '';
  const enqueue = async (login, cmd, opts) => {
    log.push({ login, ...cmd, opts });
    const h = over[cmd.kind];
    if (h) { const r = await h(cmd, url); if (r) return r; }
    if (cmd.kind === 'navigate') { url = cmd.params.url; return { ok: true, result: { url } }; }
    if (cmd.kind === 'snapshot' && cmd.params.selector) return { ok: true, result: { fields: [{ id: 'q1', label: 'Опыт?' }] } };
    if (cmd.kind === 'snapshot') return { ok: true, result: { url, html: url.includes('/search/') ? SERP : url.includes('negotiations') ? '<neg/>' : '<h1>Вакансия</h1>' } };
    if (cmd.kind === 'hh_apply') return { ok: true, result: { status: 'sent' } };
    return { ok: true, result: {} };
  };
  return { enqueue, log };
}
function deps(ext, extra = {}) {
  const applied = [];
  const d = { enqueue: ext.enqueue, now: () => NOON, rand: () => 0.5, recordApplied: async (l, r) => applied.push({ l, ...r }),
    answer: async (l, b) => ({ answers: b.fields.map(f => ({ id: f.id, value: 'Да' })) }), context: async () => ({ resume: 'transit' }),
    settings: async () => ({ maxPages: 1 }), ...extra };
  return { d, applied };
}

test('1) один отклик: navigate → snapshot → wait → form → answer → hh_apply → applied', async () => {
  const ext = fakeExt();
  const { d, applied } = deps(ext, { settings: async () => ({ maxPages: 1 }) });
  const st = freshState('roman', NOON);
  st.teaAt = NOON; st.negotiationsAt = NOON;
  st.queue = [{ id: '555', title: 'Svelte dev', url: 'https://hh.ru/vacancy/555' }];
  let last;
  const kinds = [];
  for (let i = 0; i < 9; i++) {
    const s = await advance(st, last, d);
    assert.equal(s.type, 'cmd');
    kinds.push(s.cmd.kind);
    last = await ext.enqueue('roman', s.cmd, s.execMs ? { execMs: s.execMs } : undefined);
  }
  assert.deepEqual(kinds, ['navigate', 'snapshot', 'wait', 'click', 'wait', 'snapshot', 'hh_apply', 'wait', 'navigate']);
  const apply = ext.log.find(c => c.kind === 'hh_apply');
  assert.deepEqual(apply.params, { vacancyId: '555', answers: { q1: 'Да' } });
  assert.equal(apply.opts.execMs, 120000);
  assert.deepEqual(applied.map(a => [a.id, a.status]), [['555', 'sent']]);
  assert.ok(ext.log.every(c => c.kind !== 'wait' || c.params.ms === undefined || c.params.ms <= 60000));
});

test('1b) таймаут hh_apply: не повторять вслепую, перепроверить', async () => {
  let applies = 0;
  const ext = fakeExt({ hh_apply: async () => (applies++, { ok: false, error: 'timeout' }),
    snapshot: async (c, url) => (!c.params.selector && applies > 0 && url.includes('/vacancy/') ? { ok: true, result: { url, html: 'Вы откликнулись' } } : null) });
  const { d, applied } = deps(ext);
  const st = freshState('roman', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '7', title: 'Dev', url: 'https://hh.ru/vacancy/7' }];
  let last;
  for (let i = 0; i < 15; i++) { const s = await advance(st, last, d); if (s.type !== 'cmd') break; last = await ext.enqueue('roman', s.cmd); }
  assert.equal(applies, 1);
  assert.deepEqual(applied[0], { l: 'roman', id: '7', url: 'https://hh.ru/vacancy/7', title: 'Dev', status: 'sent', reason: 'уже откликались' });
});

test('1c) таймаут без подтверждения → needsHuman, без второго hh_apply', async () => {
  let applies = 0;
  const ext = fakeExt({ hh_apply: async () => (applies++, { ok: false, error: 'timeout' }) });
  const { d, applied } = deps(ext);
  const st = freshState('roman', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '8', title: 'Dev', url: 'https://hh.ru/vacancy/8' }];
  let last;
  for (let i = 0; i < 15; i++) { const s = await advance(st, last, d); if (s.type !== 'cmd') break; last = await ext.enqueue('roman', s.cmd); }
  assert.equal(applies, 1);
  assert.equal(applied[0].status, 'needsHuman');
});

test('2) поиск и очередь: serp → parse → filterKnown → titleStop → отклики', async () => {
  const ext = fakeExt();
  const { d, applied } = deps(ext, { filterKnown: async (l, cards) => cards.filter(c => c.id !== '103') });
  const store = createStore(); store.setEnabled('roman', true);
  store.get('roman', NOON).negotiationsAt = NOON;
  const r = await createPlanner(store, d).kick('roman', 30);
  assert.ok(ext.log[0].params.url.startsWith('https://hh.ru/search/vacancy'));
  assert.deepEqual(applied.map(a => [a.id, a.status]), [['101', 'sent'], ['102', 'skip']]);
  assert.match(applied[1].reason, /стоп-слово/);
  assert.ok(r.steps <= 30); // chain is finite
  assert.deepEqual(parseSerp(SERP).cards.map(c => c.id), ['101', '102', '103']);
});

test('3) рабочие часы, чай, темп, negotiations', async () => {
  const night = Date.UTC(2026, 9, 15, 20, 0); // 23:00 MSK
  assert.equal(hoursOpen(night, true), false);
  assert.equal(hoursOpen(night, false), true);
  assert.equal(hoursOpen(NOON, true), true);
  assert.equal(msToOpen(night), 10 * 3600_000);
  const ext = fakeExt();
  const { d } = deps(ext, { now: () => night });
  assert.equal((await advance(freshState('r', night), undefined, d)).type, 'idle');
  // tea
  const st = freshState('r', NOON - 46 * 60_000);
  const s = await advance(st, undefined, { ...d, now: () => NOON, rand: () => 0.1 });
  assert.equal(s.type, 'idle'); assert.equal(s.reason, 'чай'); assert.ok(s.retryMs >= 300000 && s.retryMs <= 600000);
  assert.equal(teaRoll(() => 0.9).hit, false);
  assert.ok(readWait(PACE_DEFAULT, () => 0.5).ms >= 10000);
  // negotiations hourly
  const ns = freshState('r', NOON); ns.teaAt = NOON;
  const ext2 = fakeExt(); let got = null;
  const { d: d2 } = deps(ext2, { onNegotiations: async (l, html) => { got = html; } });
  let last; for (let i = 0; i < 2; i++) { const x = await advance(ns, last, d2); last = await ext2.enqueue('r', x.cmd); }
  await advance(ns, last, d2);
  assert.equal(ext2.log[0].params.url, 'https://hh.ru/applicant/negotiations?state=all');
  assert.equal(got, '<neg/>');
});

test('4) капча/детект/логин → stop + needsHuman, дальше ничего не шлём до release', async () => {
  assert.equal(pageSignal({ text: 'Вам недоступна эта вакансия' }), 'detect');
  assert.equal(pageSignal({ url: 'https://hh.ru/account/captcha' }), 'captcha');
  assert.equal(pageSignal({ url: 'https://hh.ru/account/login' }), 'login');
  assert.match(titleStop('Angular dev'), /angular/i);
  const ext = fakeExt({ snapshot: async (c, url) => (url.includes('/vacancy/') && !c.params.selector ? { ok: true, result: { url, captcha: true } } : null) });
  const { d } = deps(ext);
  const store = createStore(); store.setEnabled('roman', true);
  const st = store.get('roman', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '9', title: 'Dev', url: 'https://hh.ru/vacancy/9' }];
  const p = createPlanner(store, d);
  const r = await p.kick('roman');
  assert.deepEqual(r.last, { type: 'stop', reason: 'капча', needsHuman: true });
  const n = ext.log.length;
  assert.equal((await p.kick('roman')).last.type, 'stop');
  assert.equal(ext.log.length, n, 'после капчи ни одной команды');
  // detect as an error from the extension
  const ext2 = fakeExt({ navigate: async () => ({ ok: false, error: 'детект: недоступна эта вакансия' }) });
  const st2 = freshState('x', NOON); st2.negotiationsAt = NOON; st2.queue = [{ id: '1', title: 'a', url: 'https://hh.ru/vacancy/1' }];
  const s1 = await advance(st2, undefined, deps(ext2).d);
  const s2 = await advance(st2, await ext2.enqueue('x', s1.cmd), deps(ext2).d);
  assert.equal(s2.type, 'stop'); assert.equal(s2.needsHuman, true);
  store.release('roman');
  assert.equal(store.get('roman', NOON).hold, null);
});

test('флаг: выключен → null (работает старая логика расширения)', () => {
  const store = createStore();
  assert.equal(createPlanner(store, deps(fakeExt()).d).kick('roman'), null);
});

test('изоляция аккаунтов: команды и состояние не пересекаются', async () => {
  const ext = fakeExt({ snapshot: async (c, url) => null });
  const { d, applied } = deps(ext);
  const store = createStore(); store.setEnabled('a', true); store.setEnabled('b', true);
  for (const l of ['a', 'b']) store.get(l, NOON).negotiationsAt = NOON;
  store.get('a', NOON).queue = [{ id: '1', title: 'A', url: 'https://hh.ru/vacancy/1' }];
  store.get('b', NOON).hold = { reason: 'капча', needsHuman: true, at: NOON };
  const p = createPlanner(store, d);
  const [ra, rb] = await Promise.all([p.kick('a', 6), p.kick('b', 6)]);
  assert.equal(rb.last.type, 'stop');
  assert.ok(ra.steps > 0);
  assert.ok(ext.log.every(c => c.login === 'a'));
  assert.ok(applied.every(x => x.l === 'a'));
  assert.equal(store.get('b', NOON).queue.length, 0);
  assert.equal(p.kick('c'), null);
});

import { planStoreDeps } from './deps-impl.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import test from 'node:test';

// Fake multi-tenant storage: each login has its own tables; functions read the current tenant like runTenant does.
function fakeIO() {
  const als = new AsyncLocalStorage();
  const db = {};
  const T = () => { const l = als.getStore(); assert.ok(l, 'вызов вне tenant'); return (db[l] ??= { links: [], queue: [], passed: [], hidden: [], outcomes: [], forgot: [], dropped: [], dayOpen: true, week: true }); };
  const notes = [];
  const io = {
    inTenant: (login, job) => als.run(login, job),
    readLinks: async n => T().links.slice(0, n),
    readQueue: async () => T().queue,
    takeRelook: async (busy, n) => T().passed.filter(r => !busy.includes(r.id)).slice(0, n),
    noteHidden: async ids => { T().hidden.push(...ids); },
    notePassed: async rows => { T().passed.push(...rows); },
    coveredWaiters: (q, ids) => q.filter(r => r.status === 'waiting' && ids.includes(r.id)).map(r => r.id),
    forgetLinks: async ids => { T().forgot.push(...ids); },
    dropWaiters: async ids => { T().dropped.push(...ids); },
    applyOutcomes: async rows => { T().outcomes.push(...rows); },
    readMemory: async () => ({ open: T().dayOpen }),
    dayOpen: m => m.open,
    readAccount: async login => ({ login, week: T().week }),
    weekOpen: (login, a) => a.login === login && a.week,
    notify: async (login, text) => { notes.push({ login, text, tenant: als.getStore() }); },
  };
  return { io, db, notes, seed: (l, f) => als.run(l, async () => f(T())) };
}

test('fetchLinks: 10 из 40, как keptLinks в /api/queue', async () => {
  const f = fakeIO();
  await f.seed('a', t => { t.links = Array.from({ length: 15 }, (_, i) => ({ id: String(100 + i), url: '', title: `T${i}` })); });
  const rows = await planStoreDeps(f.io).fetchLinks('a');
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], { id: '100', url: 'https://hh.ru/vacancy/100', title: 'T0' });
});

test('claimRelook: занятые в очереди не берутся', async () => {
  const f = fakeIO();
  await f.seed('a', t => { t.queue = [{ id: '1', status: 'pending' }]; t.passed = [{ id: '1', title: 'x' }, { id: '2', title: 'Y', company: 'C' }]; });
  assert.deepEqual(await planStoreDeps(f.io).claimRelook('a'), [{ id: '2', title: 'Y', company: 'C', url: 'https://hh.ru/vacancy/2' }]);
});

test('postHidden: noteHidden + notePassed + снятие ожидающих', async () => {
  const f = fakeIO();
  await f.seed('a', t => { t.queue = [{ id: '7', status: 'waiting' }]; });
  await planStoreDeps(f.io).postHidden('a', { id: '7', title: 'PHP', reason: 'стоп-слово' });
  const a = f.db.a;
  assert.deepEqual([a.hidden, a.passed.map(r => r.id), a.forgot, a.dropped], [['7'], ['7'], ['7'], ['7']]);
  // busy row → hidden but not passed
  await f.seed('b', t => { t.queue = [{ id: '8', status: 'sent' }]; });
  await planStoreDeps(f.io).postHidden('b', { id: '8', title: 'x', reason: 'r' });
  assert.deepEqual([f.db.b.hidden, f.db.b.passed], [['8'], []]);
});

test('onInvitation: исход invitation + уведомление, без сообщений работодателю', async () => {
  const f = fakeIO();
  await planStoreDeps(f.io).onInvitation('a', { vacancyId: '21', state: 'invitation', employer: 'Acme', title: 'Front', url: 'https://hh.ru/vacancy/21', updatedAt: 5 });
  assert.deepEqual(f.db.a.outcomes, [{ id: '21', outcome: 'invitation', at: 5 }]);
  assert.match(f.notes[0].text, /Приглашение: Front \(Acme\)/);
  assert.equal(f.notes[0].tenant, 'a');
});

test('quota: day/week из существующих гейтов; coverLetter — пустая заглушка', async () => {
  const f = fakeIO();
  await f.seed('a', t => { t.dayOpen = false; });
  await f.seed('b', t => { t.week = false; });
  const d = planStoreDeps(f.io);
  assert.deepEqual(await d.quota('a'), { day: false, week: true });
  assert.deepEqual(await d.quota('b'), { day: true, week: false });
  assert.equal(await d.coverLetter('a'), '');
});

test('изоляция аккаунтов: данные одного логина не видны и не меняются у другого', async () => {
  const f = fakeIO();
  await f.seed('a', t => { t.links = [{ id: '1', url: '', title: 'A' }]; t.passed = [{ id: '9', title: 'A9' }]; });
  await f.seed('b', t => { t.links = [{ id: '2', url: '', title: 'B' }]; });
  const d = planStoreDeps(f.io);
  const [la, lb] = await Promise.all([d.fetchLinks('a'), d.fetchLinks('b')]);
  assert.deepEqual([la.map(r => r.id), lb.map(r => r.id)], [['1'], ['2']]);
  assert.deepEqual(await d.claimRelook('b'), []);
  await d.postHidden('b', { id: '1', title: 'x', reason: 'r' });
  assert.deepEqual(f.db.a.hidden, []);
  assert.deepEqual(f.db.b.hidden, ['1']);
});

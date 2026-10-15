// Fake extension over the real stage-B bus (thin/cmd-bus.ts) and the real driver: search → apply → applied.
import { createBus } from '../thin/cmd-bus.ts';
import { createStore, createPlanner } from './index.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

const NOON = Date.UTC(2026, 9, 15, 9, 0);
const SERP = '<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/42"><span data-qa="serp-item__title">Frontend Svelte</span></a></div>';
const FORM = '<div data-qa="vacancy-response-popup"><div data-qa="task-question"><div>Опыт?</div><textarea name="q1"></textarea></div></div>';

function fakeExtension(bus, login) {
  let url = ''; let stop = false; const seen = [];
  const loop = (async () => {
    while (!stop) {
      const w = await bus.next(login, undefined, 50);
      if (!w) continue;
      seen.push(w.kind);
      let result = {};
      if (w.kind === 'navigate') { url = w.params.url; result = { url }; }
      if (w.kind === 'snapshot') result = { url, html: url.includes('/search/') ? SERP : w.params.selector ? FORM : '<h1>vac</h1>' };
      if (w.kind === 'hh_apply') result = { status: 'sent' };
      bus.report(login, { id: w.id, ok: true, result });
    }
  })();
  return { seen, close: async () => { stop = true; await loop; } };
}

test('e2e: поиск → отклик → applied через настоящий cmd-bus', async () => {
  const bus = createBus({ log: () => {} });
  const ext = fakeExtension(bus, 'roman');
  const other = fakeExtension(bus, 'anna');
  const applied = [];
  const store = createStore(); store.setEnabled('roman', true);
  const st = store.get('roman', NOON); st.negotiationsAt = NOON;
  const planner = createPlanner(store, {
    enqueue: bus.enqueue, now: () => NOON, rand: () => 0,
    settings: async () => ({ maxPages: 1, pace: { readMin: 0, readMax: 0, distractMin: 0, distractMax: 0, fastEvery: 100, fastMin: 0, fastMax: 0 } }),
    answer: async (l, b) => ({ answers: b.fields.map(f => ({ id: f.id, value: '3 года' })) }),
    recordApplied: async (l, r) => applied.push({ l, ...r }),
  });
  await planner.kick('roman', 12);
  await ext.close(); await other.close();
  assert.deepEqual(applied.map(a => [a.l, a.id, a.status]), [['roman', '42', 'sent']]);
  assert.deepEqual(ext.seen.slice(0, 9), ['navigate', 'snapshot', 'navigate', 'snapshot', 'wait', 'click', 'wait', 'snapshot', 'hh_apply']);
  assert.equal(other.seen.length, 0, 'чужой аккаунт ничего не получил');
});

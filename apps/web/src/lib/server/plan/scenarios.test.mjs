import { advance } from './index.ts';
import { freshState } from './state.ts';
import { murkyBlock, testTask, resumeKind, msToMonday, hideSelector } from './scenarios.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

const NOON = Date.UTC(2026, 9, 15, 9, 0); // Thu 12:00 MSK
const card = (id, t) => `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}"><span data-qa="serp-item__title">${t}</span></a></div>`;
const FORM = '<div data-qa="vacancy-response-popup"><div data-qa="task-question"><div>Опыт?</div><textarea name="q"></textarea></div></div>';

function setup(pages, sc, extra = {}) {
  const log = []; const applied = []; let url = '';
  const enqueue = async (login, c) => {
    log.push(c);
    if (c.kind === 'navigate') { url = c.params.url; return { ok: true, result: { url } }; }
    if (c.kind === 'snapshot') return { ok: true, result: { url, html: pages(url, c.params.selector) } };
    if (c.kind === 'hh_apply') return { ok: true, result: { status: 'sent' } };
    return { ok: true, result: {} };
  };
  const d = { enqueue, now: () => NOON, rand: () => 0.5, recordApplied: async (l, r) => applied.push(r),
    answer: async (l, b) => ({ answers: b.fields.map(f => ({ id: f.id, value: 'да' })) }),
    settings: async () => ({ maxPages: 1, scenarios: sc }), ...extra };
  const st = freshState('r', NOON); st.negotiationsAt = NOON;
  const run = async (n) => { let last, s; for (let i = 0; i < n; i++) { s = await advance(st, last, d); if (s.type !== 'cmd') return s; last = await enqueue('r', s.cmd); } return s; };
  return { st, log, applied, run, d };
}
const vac = (id = '5', title = 'Node.js backend') => ({ id, title, url: `https://hh.ru/vacancy/${id}` });

test('правила: цыганщина, тестовое, вид резюме, понедельник', () => {
  assert.match(murkyBlock('<p>Напишите кодовое слово</p>'), /кодовое слово/);
  assert.equal(murkyBlock('обычная вакансия'), '');
  assert.equal(testTask('Нужно выполнить тестовое задание'), true);
  assert.equal(resumeKind('Node.js backend'), 'fullstack');
  assert.equal(resumeKind('React frontend'), 'frontend');
  assert.equal(msToMonday(NOON), (4 * 24 - 3) * 3600_000); // Thu 12:00 → Mon 09:00
  assert.match(hideSelector('7'), /:has\(a\[href\*="\/vacancy\/7"\]\)/);
});

test('флаги по умолчанию выключены: цыганщина не останавливает', async () => {
  const s = setup((u, sel) => sel ? FORM : 'кодовое слово', {});
  s.st.queue = [vac()];
  await s.run(9);
  assert.equal(s.applied[0].status, 'sent');
});

test('murky/testTask → needsHuman без hh_apply', async () => {
  for (const [html, flag, re] of [['кодовое слово', 'murky', /цыганщина/], ['выполните тестовое задание', 'testTask', /тестовое/]]) {
    const s = setup((u, sel) => sel ? FORM : html, { [flag]: true });
    s.st.queue = [vac()];
    await s.run(4);
    assert.equal(s.applied[0].status, 'needsHuman'); assert.match(s.applied[0].reason, re);
    assert.ok(s.log.every(c => c.kind !== 'hh_apply'));
  }
});

test('jobOffer: клик по крестику баннера, потом обычный отклик', async () => {
  const s = setup((u, sel) => sel ? FORM : 'Вы приняли предложение о работе', { jobOffer: true });
  s.st.queue = [vac()];
  await s.run(10);
  assert.deepEqual(s.log[2], { kind: 'click', params: { selector: 'button[data-qa="banner-close"]', timeoutMs: 5000 } });
  assert.equal(s.applied[0].status, 'sent');
});

test('letter + resumePick: письмо транзитом в hh_apply.letter, вид резюме в answers', async () => {
  const s = setup((u, sel) => sel ? FORM : '<h1>v</h1>', { letter: true, resumePick: true }, { coverLetter: async () => 'Здравствуйте' });
  s.st.queue = [vac()];
  await s.run(8);
  const a = s.log.find(c => c.kind === 'hh_apply');
  assert.equal(a.params.letter, 'Здравствуйте');
  assert.deepEqual(a.params.answers, { q: 'да', __resumeKind: 'fullstack' });
  const e = setup((u, sel) => sel ? FORM : '<h1>v</h1>', { letter: true }, { coverLetter: async () => '  ' });
  e.st.queue = [vac()];
  await e.run(8);
  assert.equal(e.applied[0].status, 'needsHuman');
  assert.ok(e.log.every(c => c.kind !== 'hh_apply'));
});

test('savedLinks и relook наполняют очередь до поиска', async () => {
  const s = setup(() => '<h1>v</h1>', { savedLinks: true, relook: true }, {
    fetchLinks: async () => [vac('1', 'A'), vac('2', 'B')], filterKnown: async (l, x) => x.filter(i => i.id !== '2'), claimRelook: async () => [vac('3', 'C')] });
  let x = await s.run(1);
  assert.equal(x.cmd.params.url, 'https://hh.ru/vacancy/1');
  s.st.current = null; s.st.phase = 'start';
  x = await s.run(1);
  assert.equal(x.cmd.params.url, 'https://hh.ru/vacancy/3');
  assert.equal(s.st.relookLeft, 7);
});

test('hideJunk: мусор с выдачи скрывается кликом и postHidden', async () => {
  const hidden = [];
  const s = setup(u => u.includes('/search/') ? card('1', 'Frontend React') + card('2', 'Курьер') + card('3', 'PHP Bitrix') : '<h1>v</h1>', { hideJunk: true },
    { postHidden: async (l, r) => hidden.push(r.id) });
  await s.run(6);
  const clicks = s.log.filter(c => c.kind === 'click').map(c => c.params.selector);
  assert.ok(clicks[0].includes('/vacancy/2') && clicks[1].includes('/vacancy/3'));
  assert.deepEqual(hidden, ['2', '3']);
  assert.equal(s.log[4].params.url, 'https://hh.ru/vacancy/1');
});

test('invites: новое приглашение уведомляется один раз; автоответ не шлётся', async () => {
  const html = '<div data-qa="negotiations-item"><a href="/vacancy/21">Back</a> Приглашение</div>';
  const seen = [];
  const s = setup(() => html, { invites: true }, { onInvitation: async (l, r) => seen.push(r.vacancyId), onNegotiations: async () => {} });
  s.st.negotiationsAt = 0; s.st.teaAt = NOON;
  await s.run(3);
  s.st.negotiationsAt = 0; s.st.phase = 'start';
  await s.run(3);
  assert.deepEqual(seen, ['21']);
  assert.ok(s.log.every(c => c.kind !== 'type'));
});

test('quota: неделя кончилась → простой до понедельника 09:00 МСК; день → до утра', async () => {
  const w = setup(() => '', { quota: true }, { quota: async () => ({ day: true, week: false }) });
  let r = await w.run(1);
  assert.deepEqual([r.type, r.reason, r.retryMs], ['idle', 'неделя кончилась', msToMonday(NOON)]);
  const dd = setup(() => '', { quota: true }, { quota: async () => ({ day: false, week: true }) });
  r = await dd.run(1);
  assert.deepEqual([r.reason, r.retryMs], ['лимит на сегодня', 21 * 3600_000]);
});

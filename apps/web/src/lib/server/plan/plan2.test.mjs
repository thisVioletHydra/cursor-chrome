import { advance } from './index.ts';
import { freshState } from './state.ts';
import { parseForm, FORM_SEL, answerProblem } from './form.ts';
import { readFileSync, existsSync } from 'node:fs';
import { parseNegotiations } from './negotiations.ts';
import { feedDry } from './rules.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

const NOON = Date.UTC(2026, 9, 15, 9, 0);
const card = (id, t) => `<div data-qa="vacancy-serp__vacancy"><a href="/vacancy/${id}"><span data-qa="serp-item__title">${t}</span></a></div>`;
const FORM = `<div data-qa="vacancy-response-popup"><textarea data-qa="vacancy-response-popup-form-letter-input"></textarea>
<div data-qa="task-question"><div>Сколько лет опыта с TypeScript?</div><textarea name="task_1_text"></textarea></div>
<div data-qa="task-question"><div>Готовы к офису?</div><label><input type="radio" name="task_2">Да</label><label><input type="radio" name="task_2">Нет</label></div>
<div data-qa="task-question"><span>Город</span><select name="task_3"><option>Москва</option><option>Бишкек</option></select></div></div>`;

function ext(pages) {
  const log = []; let url = '';
  return { log, enqueue: async (login, cmd) => {
    log.push(cmd);
    if (cmd.kind === 'navigate') { url = cmd.params.url; return { ok: true, result: { url } }; }
    if (cmd.kind === 'snapshot') return { ok: true, result: { url, html: pages(url, cmd.params.selector) } };
    if (cmd.kind === 'hh_apply') return { ok: true, result: { status: 'sent' } };
    return { ok: true, result: {} };
  } };
}
async function run(st, d, e, max) { let last, s; for (let i = 0; i < max; i++) { s = await advance(st, last, d); if (s.type !== 'cmd') return s; last = await e.enqueue(st.login, s.cmd); } return s; }

test('форма: парсинг полей, письма, радио, селекта', () => {
  const f = parseForm(FORM);
  assert.equal(f.letter, true);
  assert.deepEqual(f.fields.map(x => [x.id, x.kind]), [['task_1_text', 'text'], ['task_2', 'choice'], ['task_3', 'select']]);
  assert.match(f.fields[0].label, /TypeScript/);
  assert.deepEqual(f.fields[1].options, ['Да', 'Нет']);
  assert.deepEqual(f.fields[2].options, ['Москва', 'Бишкек']);
  assert.equal(parseForm('<div>Для отклика необходимо ответить на несколько вопросов</div>').questionnaire, true);
});

test('форма в сценарии: снимок по FORM_SEL.root, поля из html → /api/answer → hh_apply.answers', async () => {
  const e = ext((url, sel) => sel ? FORM : '<h1>vac</h1>');
  let asked;
  const d = { enqueue: e.enqueue, now: () => NOON, rand: () => 0.5, answer: async (l, b) => (asked = b.fields, { answers: b.fields.map(f => ({ id: f.id, value: f.options[0] ?? 'x' })) }) };
  const st = freshState('r', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '5', title: 'TS dev', url: 'https://hh.ru/vacancy/5' }];
  await run(st, d, e, 8);
  assert.deepEqual(e.log.slice(3, 6).map(c => [c.kind, c.params.selector]), [['click', FORM_SEL.applyButton], ['wait', FORM_SEL.root], ['snapshot', FORM_SEL.root]]);
  assert.equal(asked.length, 3);
  assert.deepEqual(e.log[6].params.answers, { task_1_text: 'x', task_2: 'Да', task_3: 'Москва' });
});

test('анкета работодателя → needsHuman без hh_apply', async () => {
  const e = ext((url, sel) => sel ? 'Для отклика необходимо ответить на несколько вопросов' : '<h1>vac</h1>');
  const applied = [];
  const d = { enqueue: e.enqueue, now: () => NOON, rand: () => 0.5, recordApplied: async (l, r) => applied.push(r) };
  const st = freshState('r', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '6', title: 'dev', url: 'https://hh.ru/vacancy/6' }];
  await run(st, d, e, 7);
  assert.equal(applied[0].status, 'needsHuman');
  assert.ok(e.log.every(c => c.kind !== 'hh_apply'));
});

test('negotiations: InitialState JSON и fallback по карточкам', async () => {
  const json = JSON.stringify({ a: { items: [{ vacancy: { id: 11, name: 'Front', employer: { name: 'Acme' } }, state: { id: 'INVITATION' }, updatedAt: 1700000000 }, { vacancyId: '12', state: 'discard' }] } });
  const rows = parseNegotiations(`<template id="HH-Lux-InitialState">${json.replace(/"/g, '&quot;')}</template>`, NOON);
  assert.deepEqual(rows.map(r => [r.vacancyId, r.state, r.employer]), [['11', 'invitation', 'Acme'], ['12', 'discard', '']]);
  assert.equal(rows[0].updatedAt, 1700000000000);
  const html = '<div data-qa="negotiations-item"><a href="https://hh.ru/vacancy/21?x=1">Back</a><a href="/employer/9">Co</a> Приглашение</div><div data-qa="negotiations-item-x"><a href="/vacancy/22">B</a> Отказ</div>';
  assert.deepEqual(parseNegotiations(html, NOON).map(r => [r.vacancyId, r.state, r.title]), [['21', 'invitation', 'Back'], ['22', 'discard', 'B']]);
  // in scenario
  const e = ext(() => html); let got;
  const st = freshState('r', NOON); st.teaAt = NOON;
  await run(st, { enqueue: e.enqueue, now: () => NOON, rand: () => 0.5, onNegotiationRows: async (l, r) => { got = r; } }, e, 3);
  assert.equal(got.length, 2);
});

test('режимы ленты: сухая лента → слова → лайт 10 шт → сон час → новый заход', async () => {
  assert.equal(feedDry('Менеджер по продажам', ''), true);
  assert.equal(feedDry('Frontend React', ''), false);
  const dry = [1, 2, 3, 4].map(i => card(`9${i}`, 'Курьер')).join('');
  const light = Array.from({ length: 12 }, (_, i) => card(`5${i}`, 'Frontend React')).join('') + '<a data-qa="pager-next"></a>';
  let now = NOON;
  const d = { enqueue: async () => ({ ok: true }), now: () => now, rand: () => 0.5, settings: async () => ({ words: ['node'], maxPages: 3 }) };
  const st = freshState('r', NOON); st.negotiationsAt = NOON;
  const page = html => ({ ok: true, result: { html } });
  let s = await advance(st, undefined, d); assert.match(s.cmd.params.url, /search\/vacancy/);
  s = await advance(st, { ok: true }, d); assert.equal(s.cmd.kind, 'snapshot');
  s = await advance(st, page(dry), d); // 3 dry in a row → words
  assert.equal(st.mode, 'words'); assert.match(s.cmd.params.url, /text=node/);
  await advance(st, { ok: true }, d);
  s = await advance(st, page(card('77', 'Node.js dev')), d);
  assert.equal(s.cmd.params.url, 'https://hh.ru/vacancy/77'); assert.equal(st.wordIdx, 1);
  st.current = null; st.phase = 'start';
  s = await advance(st, undefined, d); assert.match(s.cmd.params.url, /work_format=REMOTE/); assert.equal(st.mode, 'light');
  await advance(st, { ok: true }, d);
  s = await advance(st, page(light), d);
  assert.equal(st.queue.length, 9); assert.equal(st.lightLeft, 0); // 10 taken, 1 in work
  st.queue = []; st.current = null; st.phase = 'start';
  s = await advance(st, undefined, d);
  assert.equal(s.type, 'idle'); assert.equal(s.retryMs, 3600_000);
  now += 30 * 60_000; st.teaAt = now; st.negotiationsAt = now;
  assert.equal((await advance(st, undefined, d)).type, 'idle');
  now += 31 * 60_000; st.teaAt = now; st.negotiationsAt = now;
  const w = await advance(st, undefined, d);
  assert.equal(w.type, 'cmd'); assert.match(w.cmd.params.url, /work_format=REMOTE/);
  assert.equal(st.lightLeft, 10);
});

async function oneVacancy(pages, answer, over = {}) {
  const e = ext(pages); const orig = e.enqueue;
  e.enqueue = async (l, c) => (over[c.kind] ? (e.log.push(c), over[c.kind](c)) : orig(l, c));
  const applied = [];
  const d = { enqueue: e.enqueue, now: () => NOON, rand: () => 0.5, recordApplied: async (l, r) => applied.push(r), answer };
  const st = freshState('r', NOON); st.negotiationsAt = NOON;
  st.queue = [{ id: '5', title: 'TS dev', url: 'https://hh.ru/vacancy/5' }];
  await run(st, d, e, 8);
  return { applied, log: e.log };
}

test('клик → сразу «Вы откликнулись» → sent без hh_apply', async () => {
  const { applied, log } = await oneVacancy((u, sel) => sel ? '<div data-qa="vacancy-response-popup">Вы откликнулись</div>' : '<h1>vac</h1>');
  assert.deepEqual([applied[0].status, applied[0].reason], ['sent', 'отклик без формы']);
  assert.ok(log.every(c => c.kind !== 'hh_apply'));
});

test('форма не появилась → снимок страницы: откликнулись → sent, иначе skip', async () => {
  let done = true;
  const pages = (u, sel) => (done ? 'Резюме доставлено' : '<h1>vac</h1>');
  const over = { wait: async c => (c.params.selector ? { ok: false, error: 'timeout' } : { ok: true, result: {} }) };
  // first snapshot (vac_read) must not show the mark, otherwise it's "уже откликались"
  let n = 0;
  const pg = (u, sel) => (n++ === 0 ? '<h1>vac</h1>' : pages(u, sel));
  let r = await oneVacancy(pg, undefined, over);
  assert.equal(r.applied[0].status, 'sent');
  done = false; n = 0;
  r = await oneVacancy(pg, undefined, { ...over, click: async () => ({ ok: false, error: 'нет элемента' }) });
  assert.deepEqual([r.applied[0].status, r.applied[0].reason], ['skip', 'нет кнопки или формы отклика']);
  assert.ok(r.log.every(c => c.kind !== 'hh_apply'));
});

test('custom-вопросы идут в /api/answer; needsHuman только при пустом обязательном или несовпавшем варианте', async () => {
  const CUSTOM = '<div data-qa="vacancy-response-popup"><div data-qa="task-question"><div>Расскажите про кейс</div><textarea name="t1" required></textarea></div></div>';
  let asked;
  const ok = await oneVacancy((u, s) => s ? CUSTOM : '<h1>v</h1>', async (l, b) => (asked = b.fields, { answers: [{ id: 't1', value: 'кейс' }] }));
  assert.equal(asked[0].custom, true); assert.equal(asked[0].required, true);
  assert.equal(ok.applied[0].status, 'sent');
  const empty = await oneVacancy((u, s) => s ? CUSTOM : '<h1>v</h1>', async () => ({ answers: [{ id: 't1', value: ' ' }] }));
  assert.equal(empty.applied[0].status, 'needsHuman'); assert.match(empty.applied[0].reason, /обязательное/);
  const bad = await oneVacancy((u, s) => s ? FORM : '<h1>v</h1>', async (l, b) => ({ answers: b.fields.map(f => ({ id: f.id, value: f.kind === 'choice' ? 'Может быть' : (f.options[0] ?? 'x') })) }));
  assert.equal(bad.applied[0].status, 'needsHuman'); assert.match(bad.applied[0].reason, /вариант не совпал/);
  assert.ok(bad.log.every(c => c.kind !== 'hh_apply'));
  assert.equal(answerProblem([{ id: 'a', kind: 'text', options: [] }], []), ''); // optional empty is fine
});

// Fixtures: repo has no saved hh HTML (only tiny inline strings in extension tests). If one appears, drop it here.
const FIX = new URL('./fixtures/', import.meta.url);
test('фикстуры hh (если есть)', { skip: !existsSync(FIX) && 'нет сохранённых HTML-фикстур hh' }, () => {
  for (const name of ['form.html', 'serp.html', 'negotiations.html']) {
    const p = new URL(name, FIX);
    if (!existsSync(p)) continue;
    const html = readFileSync(p, 'utf8');
    if (name === 'form.html') assert.ok(parseForm(html).fields.length > 0);
    if (name === 'negotiations.html') assert.ok(parseNegotiations(html).length > 0);
  }
});

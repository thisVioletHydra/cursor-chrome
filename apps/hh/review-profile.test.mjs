import { draftAnswers } from './src/review/draft.ts';
import { rememberCorrections, saveCanon } from './src/review/memory.ts';
import { evaluateRule, fillTemplate, holds, isPersonalQuestion, parseProfile, profileAnswer } from './src/review/profile.ts';
import { PROFILE_QUESTIONS } from './src/review/profile-questions.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

async function freshStore() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-profile-')), 'hh.json');
}

const text = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const choice = (prompt, options) => ({ prompt, kind: 'choice', options, choices: options.map(label => ({ value: label, label })), multi: false, required: false, fieldKey: '' });
const CITY_RULE = { mode: 'conditions', cases: [{ when: [{ field: 'city', op: 'is', value: 'Москва' }], value: 'Москва' }], otherwise: 'Тестоград' };
const PROFILE = parseProfile({ savedAt: 1, fields: { city: CITY_RULE, testTask: { mode: 'fixed', value: 'да' } }, custom: [] });
const CHAIN = [{ id: 'groq', name: 'Groq', url: 'http://mock/chat/completions', model: 'm', key: 'k' }];

function mockModel(answers) {
  const real = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    prompts.push(prompt);
    const content = prompt.includes('"best"') ? '{"best":0,"confidence":0}' : JSON.stringify({ answers });

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };

  return { prompts, restore: () => { globalThis.fetch = real; } };
}

test('conditions: city modes fixed / as in vacancy / by conditions', () => {
  assert.equal(evaluateRule(CITY_RULE, { city: 'Москва' }), 'Москва');
  assert.equal(evaluateRule(CITY_RULE, { city: 'москва ' }), 'Москва', 'case and spaces ignored');
  assert.equal(evaluateRule(CITY_RULE, { city: 'Казань' }), 'Тестоград');
  assert.equal(evaluateRule(CITY_RULE, {}), 'Тестоград');
  assert.equal(evaluateRule({ mode: 'fixed', value: 'Алматы' }, { city: 'Москва' }), 'Алматы');
  assert.equal(evaluateRule({ mode: 'vacancy', field: 'city' }, { city: 'Казань' }), 'Казань');
  assert.equal(evaluateRule({ mode: 'vacancy', field: 'city', fallback: 'Тестоград' }, {}), 'Тестоград');
  assert.equal(evaluateRule(undefined, {}), '');
});

test('conditions are generic: other fields, operators, all-of', () => {
  assert.equal(holds({ field: 'salary', op: 'gte', value: '90000' }, { salaryTo: 100000 }), true);
  assert.equal(holds({ field: 'title', op: 'contains', value: 'vue' }, { title: 'Frontend (Vue 3)' }), true);
  assert.equal(holds({ field: 'office', op: 'is', value: 'да' }, { office: true }), true);
  const rule = { mode: 'conditions', cases: [{ when: [{ field: 'city', op: 'is', value: 'Москва' }, { field: 'office', op: 'is', value: 'да' }], value: 'офис ок' }], otherwise: 'только удалённо' };
  assert.equal(evaluateRule(rule, { city: 'Москва', office: false }), 'только удалённо');
  assert.equal(evaluateRule(rule, { city: 'Москва', office: true }), 'офис ок');
});

test('canon rules can use conditions through templates', () => {
  assert.equal(fillTemplate('Живу в {{profile.city}}, вакансия в {{vacancy.city}}', PROFILE, { city: 'Москва' }), 'Живу в Москва, вакансия в Москва');
  assert.equal(fillTemplate('{{profile.city}}', PROFILE, { city: 'Казань' }), 'Тестоград');
});

test('parseProfile drops junk', () => {
  const parsed = parseProfile('{"fields":{"city":{"mode":"bogus"},"x y":{"mode":"fixed","value":"1"},"ok":{"mode":"conditions","cases":[{"when":[{"field":"nope","op":"is","value":"a"}],"value":"b"}],"otherwise":"c"}},"custom":[{"key":"pet","label":"Питомец","aliases":["Есть ли кот?"]}]}');
  assert.deepEqual(Object.keys(parsed.fields), ['ok']);
  assert.deepEqual(parsed.fields.ok.cases, []);
  assert.equal(parsed.custom[0].label, 'Питомец');
  assert.equal(parseProfile('not json'), null);
});

test('profile answers paraphrased hh questions; choice snapped to option', () => {
  assert.equal(profileAnswer(text('В каком городе вы проживаете?'), PROFILE, { city: 'Москва' })?.answer, 'Москва');
  assert.equal(profileAnswer(text('Ваш город'), PROFILE, { city: 'Новосибирск' })?.answer, 'Тестоград');
  assert.equal(profileAnswer(choice('Готовы выполнить тестовое задание?', ['Да', 'Нет']), PROFILE, {})?.answer, 'Да');
  assert.equal(profileAnswer(text('Ваше гражданство?'), PROFILE, {}), null, 'empty field → no answer');
  assert.ok(PROFILE_QUESTIONS.length >= 8);
});

test('personal-fact detection', () => {
  for (const prompt of ['В каком городе вы проживаете?', 'Ваше гражданство?', 'Можете ли предоставить выписку из трудовой книжки?', 'Готовы к переезду?', 'Ваши зарплатные ожидания'])
    assert.equal(isPersonalQuestion(prompt), true, prompt);
  for (const prompt of ['Опыт с React Server Components?', 'Расскажите о самом сложном проекте', 'Сколько лет коммерческого опыта с Vue?'])
    assert.equal(isPersonalQuestion(prompt), false, prompt);
});

test('no fabrication: personal question without profile/memory stays empty «нужен твой ответ», model output filtered', async () => {
  await freshStore();
  const model = mockModel([{ n: 1, answer: 'Делал SSR на Nuxt', missing: false }, { n: 2, answer: 'Россия', missing: false }]);
  try {
    const result = await draftAnswers(CHAIN, { id: '1', title: 't', company: 'c', info: { city: 'Москва' }, questions: [text('Ваше гражданство?'), text('Опыт с SSR?')], formText: '', resume: '', profile: PROFILE });
    assert.equal(result.drafts[0].answer, '');
    assert.equal(result.drafts[0].missing, true);
    assert.match(result.drafts[0].why, /нужен твой ответ/);
    const drafting = model.prompts.filter(prompt => prompt.includes('черновики'));
    assert.equal(drafting.length, 1);
    assert.ok(drafting[0].includes('Ваше гражданство') === false, 'personal question is not sent to the drafting model');
    assert.match(drafting[0], /нужен твой ответ/);
    assert.equal(result.drafts[1].answer, 'Делал SSR на Nuxt');
  }
  finally {
    model.restore();
  }
});

test('post-filter: a model answer to a personal question is discarded', async () => {
  await freshStore();
  const model = mockModel([{ n: 1, answer: 'Москва', missing: false }]);
  try {
    // no profile and no memory: question still personal → never asked, never filled
    const result = await draftAnswers(CHAIN, { id: '2', title: 't', company: 'c', info: null, questions: [text('Где вы находитесь?')], formText: '', resume: '', profile: null });
    assert.equal(result.drafts[0].answer, '');
    assert.match(result.drafts[0].why, /нужен твой ответ/);
  }
  finally {
    model.restore();
  }
});

test('profile priority: profile beats memory (even human), canon beats profile', async () => {
  await freshStore();
  await rememberCorrections([{ key: '', prompt: 'В каком городе вы проживаете?', answer: 'Алматы', edited: true }]);
  let result = await draftAnswers([], { id: '3', title: 't', company: 'c', info: { city: 'Москва' }, questions: [text('В каком городе вы проживаете?')], formText: '', resume: '', profile: PROFILE });
  assert.equal(result.drafts[0].answer, 'Москва');
  assert.equal(result.drafts[0].source.kind, 'profile');
  result = await draftAnswers([], { id: '4', title: 't', company: 'c', info: { city: 'Казань' }, questions: [text('В каком городе вы проживаете?')], formText: '', resume: '', profile: PROFILE });
  assert.equal(result.drafts[0].answer, 'Тестоград');
  await saveCanon({ title: 'В каком городе вы проживаете?', answer: 'Город: {{profile.city}}', aliases: [] });
  result = await draftAnswers([], { id: '5', title: 't', company: 'c', info: { city: 'Москва' }, questions: [text('В каком городе вы проживаете?')], formText: '', resume: '', profile: PROFILE });
  assert.equal(result.drafts[0].answer, 'Город: Москва');
  assert.equal(result.drafts[0].source.kind, 'canon');
});

test('memory still answers a personal question when the profile field is empty', async () => {
  await freshStore();
  await rememberCorrections([{ key: '', prompt: 'Ваше гражданство?', answer: 'Кыргызстан', edited: true }]);
  const result = await draftAnswers([], { id: '6', title: 't', company: 'c', info: null, questions: [text('Ваше гражданство?')], formText: '', resume: '', profile: PROFILE });
  assert.equal(result.drafts[0].answer, 'Кыргызстан');
});

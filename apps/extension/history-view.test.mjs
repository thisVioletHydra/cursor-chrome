import { displayTitle, vacancyIdFromUrl, viewItems } from './src/diary/history-view.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const r = (o = {}) => ({ title: 'Отклик на вакансию', company: '', url: 'https://hh.ru/applicant/vacancy_response?vacancyId=111', vacancyId: '', status: 'needsHuman', hints: ['вопросы работодателя'], sentAt: 1, ...o });
const on = { linked: true, login: 'thisVioletHydra' };

test.test('без связи список не показывается, данные не меняются', () => {
  const items = [r(), r({ vacancyId: '2' })];
  const copy = structuredClone(items);
  assert.deepEqual(viewItems(items, { linked: false, login: 'thisVioletHydra' }), []);
  assert.deepEqual(items, copy);
});

test.test('дедуп по id вакансии (поле или url)', () => {
  const items = [r(), r({ sentAt: 2 }), r({ sentAt: 3 }), r({ vacancyId: '111', sentAt: 4 }), r({ url: 'https://hh.ru/vacancy/222' })];
  const shown = viewItems(items, on);
  assert.equal(shown.length, 2);
  assert.equal(vacancyIdFromUrl('https://hh.ru/vacancy/222?x=1'), '222');
});

test.test('название: реальное, если есть; «Отклик на вакансию» → вакансия <id>; иначе прежнее', () => {
  assert.equal(displayTitle(r({ title: 'Frontend-разработчик' })), 'Frontend-разработчик');
  assert.equal(displayTitle(r({ vacancyId: '111' })), 'вакансия 111');
  assert.equal(displayTitle(r()), 'Отклик на вакансию');
});

test.test('фильтр по аккаунту: чужие скрыты, без owner = thisVioletHydra', () => {
  const items = [r({ vacancyId: '1' }), r({ vacancyId: '2', owner: 'vasya-pupkin' }), r({ vacancyId: '3', owner: 'thisVioletHydra' })];
  assert.deepEqual(viewItems(items, { linked: true, login: 'vasya-pupkin' }).map(item => item.vacancyId), ['2']);
  assert.deepEqual(viewItems(items, { linked: true, login: 'thisVioletHydra' }).map(item => item.vacancyId), ['1', '3']);
  assert.deepEqual(viewItems(items, { linked: true, login: '' }).map(item => item.vacancyId), []);
});

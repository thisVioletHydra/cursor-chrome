import { judge } from './src/scan/judge.ts';
import { hardSkip, NO_META, titleFront, titleStack } from './src/scan/rules.ts';
import { EMPTY_RULES, ruleSkip } from './src/scan/score.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

const react = {
  id: '137786754',
  title: 'Разработчик React',
  company: 'МКБ',
  url: 'https://hh.ru/vacancy/137786754',
  text: 'Формат: на месте работодателя, удалённо или гибрид. Удаленный режим работы на всей территории РФ. Рядом в тексте стажёр и PHP.',
  formUrl: '',
  formBlocked: false,
  ...NO_META,
};

test('a react title is not a junior skip because the page mentions an intern', () => {
  assert.equal(titleStack('Разработчик React'), true);
  assert.equal(titleStack('React Native'), false);
  assert.equal(titleFront('Fullstack-разработчик (JavaScript / TypeScript, PHP)'), true);
  assert.equal(titleFront('Специалист по набору клиентской базы на покупку-продажу недвижимости'), false);
  assert.equal(hardSkip({ ...react, title: 'Junior React', text: 'React' }), 'джуниор');
  assert.equal(hardSkip({ ...react, text: 'Только офис, удалёнку не рассматриваем.' }), 'удалёнку запрещают');
  assert.equal(hardSkip(react), null);
  assert.equal(hardSkip({
    ...react,
    title: 'Fullstack-разработчик PHP · React · API только Санкт-Петербург',
    text: 'Работа удаленная, очные спринты один раз в неделю в офисе в Санкт-Петербурге обязательны!',
  }), 'стоп-слово «php»');
  assert.equal(hardSkip({
    ...react,
    title: 'Fullstack-разработчик React',
    text: 'Работа удаленная, очные спринты один раз в неделю в офисе в Санкт-Петербурге обязательны!',
  }), 'офис обязателен');
  assert.equal(hardSkip({
    ...react,
    title: 'Frontend-разработчик — Angular',
    text: 'Angular, город в резюме не совпал.',
  }), 'стоп-слово «angular»');
});

test('a model skip does not throw away a stack title', async () => {
  const report = await judge(react, {
    dry: true,
    model: async () => ({ verdict: 'skip', reason: 'удалёнка только по РФ' }),
    modelLeft: () => true,
    takeModel: () => {},
  });
  assert.equal(report.verdict, 'apply');
  assert.equal(report.reason, 'наш стек');
});

test('php in the title is a skip even when react is there too', () => {
  const rules = { ...EMPTY_RULES, stopWords: ['php', 'bitrix', 'react native'] };
  const php = {
    ...react,
    title: 'Fullstack-разработчик PHP · React · API',
    text: 'PHP от 3 лет, и современный 8.x, и легаси без фреймворка',
  };
  assert.equal(ruleSkip(php, rules), 'стоп-слово «php»');
  assert.equal(ruleSkip(react, rules), null);
});

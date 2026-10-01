import { judge } from './src/scan/judge.ts';
import { hardSkip, NO_META, titleFront, titleStack } from './src/scan/rules.ts';

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

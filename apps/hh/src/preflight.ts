import type { Model, Vacancy } from './rules.ts';

import { judge } from './judge.ts';

import process from 'node:process';

const OFFICE: Vacancy = {
  id: '1',
  title: 'Офис',
  company: 'Офисная',
  url: 'https://hh.ru/vacancy/1',
  text: 'Только офис, удалёнку не рассматриваем.',
  formUrl: '',
  formBlocked: false,
};

const PYTHON: Vacancy = {
  id: '2',
  title: 'Python backend',
  company: 'Питон',
  url: 'https://hh.ru/vacancy/2',
  text: 'Основной бэкенд Django и FastAPI.',
  formUrl: '',
  formBlocked: false,
};

const OURS: Vacancy = {
  id: '3',
  title: 'Frontend TypeScript',
  company: 'Рога и копыта',
  url: 'https://hh.ru/vacancy/3',
  text: 'TypeScript, React, NestJS. Удалёнку не запрещали.',
  formUrl: '',
  formBlocked: false,
};

const FORM: Vacancy = {
  id: '4',
  title: 'Форма',
  company: 'Форма',
  url: 'https://hh.ru/vacancy/4',
  text: 'Нужно пройти тест.',
  formUrl: 'https://docs.google.com/forms/d/e/test/viewform',
  formBlocked: true,
};

export async function preflight(): Promise<void> {
  let calls = 0;
  const model: Model = async () => {
    calls += 1;
    return { verdict: 'apply', reason: 'наш стек' };
  };
  const opts = {
    dry: true,
    model,
    modelLeft: () => true,
    takeModel: () => {},
  };
  const reports = [
    await judge(OFFICE, opts),
    await judge(PYTHON, opts),
    await judge(OURS, opts),
    await judge(FORM, opts),
  ];
  const lines = reports.map(report => report.line);
  const ok = calls === 1
    && lines[0] === 'Офисная. Скип, удалёнку запрещают. https://hh.ru/vacancy/1'
    && lines[1] === 'Питон. Скип, Python основной бэк. https://hh.ru/vacancy/2'
    && lines[2] === 'Рога и копыта. Откликнулся бы. https://hh.ru/vacancy/3'
    && lines[3] === 'Форма. Застрял, зову человека. https://hh.ru/vacancy/4';
  if (ok === false) {
    console.error(lines.join('\n'));
    console.error(`model ${calls}`);
    process.exitCode = 1;
    return;
  }

  console.log('PASS');
}

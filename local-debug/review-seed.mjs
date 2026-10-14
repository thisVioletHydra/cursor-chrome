// Local fixture for the «Разбор» tab. Writes ONLY into local-debug/data/review (gitignored by `data/`).
// Usage: node local-debug/review-seed.mjs   (refuses to run on Railway)
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

if (process.env.RAILWAY_ENVIRONMENT) {
  console.error('review-seed: не на Railway');
  process.exit(1);
}

const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'data/review');
process.env.HH_STORE = path.join(dir, 'hh.json');
await fsPromises.mkdir(dir, { recursive: true });

const store = await import('../apps/hh/src/review/store.ts');
const now = Date.now();
const vac = (id, title, company, city, format, office, from, to) => ({
  id, title, company, city, format, office, salaryFrom: from, salaryTo: to, currency: from || to ? 'RUR' : '',
  salaryText: from && to ? `${from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')} ₽` : from ? `от ${from.toLocaleString('ru-RU')} ₽` : '',
  url: `https://hh.ru/vacancy/${id}`, description: 'Фикстура для локальной проверки вкладки «Разбор».',
});
const rows = [
  { id: '900000006', title: 'Frontend-разработчик (Vue/Nuxt)', company: 'Фикстура Зета', info: vac('900000006', 'Frontend-разработчик (Vue/Nuxt)', 'Фикстура Зета', 'Москва', 'Удалённо', false, 260000, 330000),
    form: [
      { prompt: 'Есть ли у вас портфолио?', kind: 'text', options: [], required: true, fieldKey: 'p1' },
      { prompt: 'Какую зарплату ожидаете?', kind: 'text', options: [], required: true, fieldKey: 'p2' },
      { prompt: 'Готовы выполнить тестовое задание?', kind: 'choice', choices: [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }, { value: 'paid', label: 'Только оплачиваемое' }], required: true, fieldKey: 'p3' },
      { prompt: 'С какими технологиями работали?', kind: 'multi', multi: true, choices: [{ value: 'vue', label: 'Vue' }, { value: 'react', label: 'React' }, { value: 'angular', label: 'Angular' }, { value: 'ts', label: 'TypeScript' }], required: false, fieldKey: 'p4' },
    ] },
  { id: '900000001', title: 'Frontend-разработчик (Vue 3)', company: 'Фикстура Альфа', info: vac('900000001', 'Frontend-разработчик (Vue 3)', 'Фикстура Альфа', 'Москва', 'Удалённо', false, 150000, 320000),
    form: [{ prompt: 'Сколько лет коммерческого опыта с Vue?', kind: 'number', options: [], required: true, fieldKey: 'task_1' }, { prompt: 'Готовы выполнить тестовое задание?', kind: 'choice', options: ['Да', 'Нет'], required: true, fieldKey: 'task_2' }, { prompt: 'Ссылка на GitHub с примерами кода', kind: 'text', options: [], required: false, fieldKey: 'task_3' }] },
  { id: '900000002', title: 'Senior React Developer', company: 'Фикстура Бета', info: vac('900000002', 'Senior React Developer', 'Фикстура Бета', 'Санкт-Петербург', 'Гибрид', true, 300000, null),
    form: [{ prompt: 'Опыт с React Server Components?', kind: 'text', options: [], required: true, fieldKey: 'q1' }, { prompt: 'Какой формат работы предпочитаете?', kind: 'choice', options: ['Офис', 'Гибрид', 'Удалённо'], required: true, fieldKey: 'q2' }] },
  { id: '900000003', title: 'Fullstack TypeScript (NestJS + Vue)', company: 'Фикстура Гамма', info: vac('900000003', 'Fullstack TypeScript (NestJS + Vue)', 'Фикстура Гамма', 'Москва', 'Удалённо', false, 180000, 220000),
    form: [{ prompt: 'Опишите опыт с PostgreSQL и Prisma', kind: 'text', options: [], required: true, fieldKey: 'q1' }, { prompt: 'Есть ли опыт с Kubernetes?', kind: 'choice', options: ['Да', 'Нет'], required: false, fieldKey: 'q2' }] },
  { id: '900000004', title: 'Frontend Lead', company: 'Фикстура Дельта', info: vac('900000004', 'Frontend Lead', 'Фикстура Дельта', 'Казань', 'Офис', true, null, null), form: null,
    hints: ['Почему вы хотите работать именно у нас?', 'Расскажите о самом сложном проекте'] },
  { id: '900000005', title: 'Vue.js разработчик в AI-продукт', company: 'Фикстура Эпсилон', info: vac('900000005', 'Vue.js разработчик в AI-продукт', 'Фикстура Эпсилон', 'Москва', 'Удалённо', false, 270000, 350000),
    form: [{ prompt: 'Сколько лет коммерческого опыта с Vue?', kind: 'number', options: [], required: true, fieldKey: 'a1' }, { prompt: 'Уровень английского?', kind: 'choice', options: ['A2', 'B1', 'B2', 'C1'], required: true, fieldKey: 'a2' }] },
];

const queue = rows.map(row => ({ id: row.id, company: row.company, title: row.title, url: `https://hh.ru/vacancy/${row.id}`, reason: 'вопросы работодателя', at: now - 3_600_000, doneAt: now - 3_600_000, status: 'needsHuman', hints: row.hints ?? (row.form ?? []).map(q => q.prompt), attempts: 1, place: row.info.city }));
await fsPromises.writeFile(path.join(dir, 'queue.json'), JSON.stringify(queue, null, 2));
for (const row of rows) {
  await store.saveVacancyInfo(row.id, row.info);
  if (row.form)
    await store.saveWaiterForm(row.id, { questions: row.form, text: '', url: `https://hh.ru/applicant/vacancy_response?vacancyId=${row.id}`, at: now });
}

// One remembered answer (reused on cards 1 and 5) and hand-made drafts for card 3, so no model is called.
await store.rememberAnswers([
  { key: '', prompt: 'Сколько лет коммерческого опыта с Vue?', answer: '7' },
  { key: '', prompt: 'Ваши зарплатные ожидания', answer: 'По рынку, готов обсудить' },
  { key: '', prompt: 'Готовы выполнить тестовое задание?', answer: 'Только оплачиваемое' },
  { key: '', prompt: 'С какими технологиями работали?', answer: 'Vue; TypeScript' },
]);
const { questionKey } = await import('../apps/hh/src/review/form.ts');
await store.saveDrafts('900000003', [
  { key: questionKey('Опишите опыт с PostgreSQL и Prisma'), prompt: 'Опишите опыт с PostgreSQL и Prisma', answer: 'PostgreSQL и Prisma использую в своих проектах на NestJS: схемы, миграции, запросы.', missing: false, why: 'стек из фактов: NestJS, Prisma, PostgreSQL', model: 'fixture' },
  { key: questionKey('Есть ли опыт с Kubernetes?'), prompt: 'Есть ли опыт с Kubernetes?', answer: '', missing: true, why: 'в фактах только «своего кластера нет», коммерческий опыт не описан', model: 'fixture' },
]);
console.log(`review-seed: ${rows.length} ждунов → ${dir}`);

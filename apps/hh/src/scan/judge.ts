import type { Model, Report, Vacancy, Verdict } from './rules.ts';

import { FACTS } from '../model/copy.ts';
import { hardSkip, lineOf, titleStack } from './rules.ts';

export type JudgeOpts = {
  dry: boolean;
  model: Model | null;
  modelLeft: () => boolean;
  takeModel: () => void;
};

export async function judge(vacancy: Vacancy, opts: JudgeOpts): Promise<Report> {
  const skipped = hardSkip(vacancy);
  if (skipped)
    return packReport(vacancy, 'skip', skipped, opts.dry);

  if (vacancy.formBlocked)
    return packReport(vacancy, 'human', 'форма без фактов', opts.dry);

  if (opts.model === null || opts.modelLeft() === false)
    return packReport(vacancy, 'human', 'модель не смотрела', opts.dry);

  opts.takeModel();
  try {
    const answer = await opts.model(vacancy);
    if (answer.verdict === 'skip' && titleStack(vacancy.title))
      return packReport(vacancy, 'apply', 'наш стек', opts.dry);

    return packReport(vacancy, answer.verdict, answer.reason, opts.dry);
  }
  catch (error) {
    const text = error instanceof Error ? error.message.trim() : '';

    return packReport(vacancy, 'human', text.length > 0 ? text.slice(0, 200) : 'модель не ответила', opts.dry);
  }
}

export function packReport(vacancy: Vacancy, verdict: Verdict, reason: string, dry: boolean): Report {
  return {
    id: vacancy.id,
    company: vacancy.company,
    url: vacancy.url,
    verdict,
    reason,
    line: lineOf(vacancy.company, verdict, reason, vacancy.url, dry),
  };
}

export function modelPrompt(vacancy: Vacancy): string {
  return [
    'Реши по вакансии: apply, skip или human.',
    'apply — наш стек. Молчание про удалёнку и удалёнка по РФ тоже apply: на собесе просится удалёнка.',
    'skip — не наш стек, скам, php/bitrix/1с в должности, или в офис надо являться: только офис, удалёнки нет, очные спринты, раз в неделю в офисе, N дней в офисе.',
    'Город Бишкек сам по себе не причина скипа. Удалёнка по РФ и Москва — apply. Обязательный день в офисе — skip.',
    'human — гугл-форма, тест, вопрос без факта.',
    'Не выдумывай Python, Kubernetes и английский C1.',
    FACTS,
    `Компания: ${vacancy.company}`,
    `Должность: ${vacancy.title}`,
    vacancy.formUrl ? `Форма: ${vacancy.formUrl}` : '',
    vacancy.text.slice(0, 6000),
    'Ответ одной строкой JSON: {"verdict":"apply|skip|human","reason":"коротко"}',
  ].filter(part => part.length > 0).join('\n');
}

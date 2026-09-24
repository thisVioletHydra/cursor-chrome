import type { Model, Report, Vacancy, Verdict } from './rules.ts';

import { FACTS } from './copy.ts';
import { hardSkip, lineOf } from './rules.ts';

export type JudgeOpts = {
  dry: boolean;
  model: Model | null;
  modelLeft: () => boolean;
  takeModel: () => void;
};

export async function judge(vacancy: Vacancy, opts: JudgeOpts): Promise<Report> {
  const skipped = hardSkip(vacancy);
  if (skipped)
    return pack(vacancy, 'skip', skipped, opts.dry);

  if (vacancy.formBlocked)
    return pack(vacancy, 'human', 'форма без фактов', opts.dry);

  if (opts.model === null || opts.modelLeft() === false)
    return pack(vacancy, 'human', 'модель не смотрела', opts.dry);

  opts.takeModel();
  const answer = await opts.model(vacancy);

  return pack(vacancy, answer.verdict, answer.reason, opts.dry);
}

function pack(vacancy: Vacancy, verdict: Verdict, reason: string, dry: boolean): Report {
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
    'apply — наш стек, удалёнку текст не запретил.',
    'skip — не наш стек или скам.',
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

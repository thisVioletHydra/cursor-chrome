export type Verdict = 'apply' | 'skip' | 'human';

export type Vacancy = {
  id: string;
  title: string;
  company: string;
  url: string;
  text: string;
  formUrl: string;
  formBlocked: boolean;
};

export type Report = {
  id: string;
  company: string;
  url: string;
  verdict: Verdict;
  reason: string;
  line: string;
};

export type Model = (vacancy: Vacancy) => Promise<{ verdict: Verdict; reason: string }>;

const OFFICE = /только офис|удалёнки нет|удаленки нет|удалённую не рассматриваем|удаленную не рассматриваем|remote-only не рассматриваем|гибрид\s+\d+\s+дн/i;
const JUNIOR = /\bjunior\b|джуниор|стажёр|стажер/i;
const JUNIOR_NO = /не\s+(?:ищем\s+)?(?:junior|джуниор|стажёр|стажер)/i;
const LEGACY = /1[cс]|битрикс|bitrix/i;
const MODERN = /nestjs|nest\.js|node\.js|\breact\b|\bvue\b/i;
const PYTHON = /\bpython\b|fastapi|django/i;

export function hardSkip(vacancy: Vacancy): string | null {
  const blob = `${vacancy.title}\n${vacancy.text}`;
  if (OFFICE.test(blob))
    return 'удалёнку запрещают';

  if (JUNIOR.test(blob) && JUNIOR_NO.test(blob) === false)
    return 'джуниор';

  if (LEGACY.test(vacancy.title) || (LEGACY.test(blob) && MODERN.test(blob) === false))
    return '1C или Bitrix ядром';

  if (PYTHON.test(blob) && MODERN.test(blob) === false)
    return 'Python основной бэк';

  return null;
}

export function lineOf(company: string, verdict: Verdict, reason: string, url: string, dry: boolean): string {
  const action: Record<Verdict, string> = {
    apply: dry ? 'Откликнулся бы' : 'В очереди',
    skip: `Скип, ${reason}`,
    human: 'Застрял, зову человека',
  };
  return `${company}. ${action[verdict]}. ${url}`;
}

import type { Actions, PageServerLoad } from './$types';
import type { Account } from '$lib/server/secrets';

import { COVER_LETTER, parseRules } from '@cursor-chrome/hh';
import { importSetupAdmin } from '$lib/server/admin-actions';
import { accountFileStat, chainOf, readAccount } from '$lib/server/secrets';
import { readSession } from '$lib/server/session';

const when = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

type SavedRow = {
  label: string;
  fact: string;
  on: boolean;
};

function countLabel(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11)
    return `${n} ${one}`;

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${n} ${few}`;

  return `${n} ${many}`;
}

function veil(secret: string): string {
  if (secret.length === 0)
    return '';

  if (secret.length <= 4)
    return '••••';

  return `••••${secret.slice(-4)}`;
}

function queryLines(raw: string): string[] {
  return raw.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

function rulesOf(raw: string) {
  if (raw.trim().length === 0)
    return parseRules(null);

  try {
    return parseRules(JSON.parse(raw));
  }
  catch {
    return parseRules(null);
  }
}

function rowsOf(account: Account | null): SavedRow[] {
  const handle = (account?.telegramLabel ?? '').match(/@[A-Za-z0-9_]+/)?.[0] ?? '';
  const chain = account === null ? [] : chainOf(account);
  const resume = account?.hhResumeId ?? '';
  const lines = queryLines(account?.hhQuery ?? '');
  const rules = rulesOf(account?.hhRules ?? '');
  const words = rules.stopWords.length + rules.mustWords.length + rules.blacklist.length;
  const rulesOn = words > 0 || rules.salaryMin > 0;
  const letter = (account?.coverLetter || COVER_LETTER).length;
  const live = account?.hhLive === '1';
  const issued = (account?.extToken.length ?? 0) > 0;

  return [
    {
      label: 'Telegram',
      on: handle.length > 0,
      fact: handle.length > 0 ? handle : 'нет',
    },
    {
      label: 'Модели',
      on: chain.length > 0,
      fact: chain.length === 0 ? 'нет' : `${chain.length} · ${chain.map(item => item.model).join(', ')}`,
    },
    {
      label: 'Резюме',
      on: resume.length > 0,
      fact: resume.length === 0 ? 'нет' : (resume.length <= 6 ? resume : `…${resume.slice(-6)}`),
    },
    {
      label: 'Запросы поиска',
      on: lines.length > 0,
      fact: countLabel(lines.length, 'строка', 'строки', 'строк'),
    },
    {
      label: 'Правила',
      on: rulesOn,
      fact: rulesOn === false ? 'выкл' : (words === 0 ? 'вкл' : countLabel(words, 'слово', 'слова', 'слов')),
    },
    {
      label: 'Сопроводительное',
      on: letter > 0,
      fact: countLabel(letter, 'символ', 'символа', 'символов'),
    },
    {
      label: 'Боевой режим',
      on: live,
      fact: live ? 'вкл' : 'выкл',
    },
    {
      label: 'Ссылка расширения',
      on: issued,
      fact: issued ? 'выпущена' : 'нет',
    },
  ];
}

function redactedOf(account: Account | null): string {
  const chain = account === null ? [] : chainOf(account);
  const rules = rulesOf(account?.hhRules ?? '');
  const shown: Record<string, unknown> = {
    telegramToken: veil(account?.telegramToken ?? ''),
    models: chain.map(item => ({
      id: item.id,
      model: item.model,
      key: veil(item.key),
    })),
    hhResumeId: account?.hhResumeId ?? '',
    hhQuery: queryLines(account?.hhQuery ?? ''),
    hhRules: {
      stopWords: rules.stopWords,
      mustWords: rules.mustWords,
      salaryMin: rules.salaryMin,
      blacklist: rules.blacklist,
    },
    coverLetterChars: (account?.coverLetter || COVER_LETTER).length,
    hhLive: account?.hhLive === '1' ? '1' : '',
    extToken: veil(account?.extToken ?? ''),
  };

  const access = account?.hhAccessToken ?? '';
  if (access.length > 0)
    shown.hhAccessToken = veil(access);

  const clientId = account?.hhClientId ?? '';
  if (clientId.length > 0)
    shown.hhClientId = veil(clientId);

  const clientSecret = account?.hhClientSecret ?? '';
  if (clientSecret.length > 0)
    shown.hhClientSecret = veil(clientSecret);

  return JSON.stringify(shown, null, 2);
}

function view(account: Account | null, stat: { bytes: number; mtimeMs: number } | null) {
  return {
    bytes: stat === null ? null : stat.bytes,
    savedAt: stat === null ? '' : when.format(stat.mtimeMs),
    rows: rowsOf(account),
    redacted: redactedOf(account),
  };
}

export const load: PageServerLoad = async ({ parent, cookies }) => {
  const { preview } = await parent();
  if (preview)
    return view(null, null);

  const session = readSession(cookies.get('session'));
  if (session === null)
    return view(null, null);

  const account = await readAccount(session.login);
  const stat = await accountFileStat(session.login);

  return view(account, stat);
};

export const actions: Actions = {
  import: importSetupAdmin,
};

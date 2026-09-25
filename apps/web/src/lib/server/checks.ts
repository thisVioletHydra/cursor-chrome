import { readAccount } from './secrets';

export type LinkStatus = {
  name: string;
  set: boolean;
  ok: boolean;
  detail: string;
};

export type Probe = {
  ok: boolean;
  detail: string;
  retryAfter: number;
};

const TIMEOUT = 8_000;

export function guestLinks(): LinkStatus[] {
  return [
    { name: 'Телега', set: false, ok: false, detail: 'токена нет' },
    { name: 'Mistral', set: false, ok: false, detail: 'ключа нет' },
    { name: 'HeadHunter', set: false, ok: false, detail: 'токена нет' },
  ];
}

export async function storedLinks(login: string): Promise<LinkStatus[]> {
  const saved = await readAccount(login);
  const telegram = saved.telegramToken;
  const mistral = saved.mistralKey;
  const hh = saved.hhAccessToken;
  const resumeId = saved.hhResumeId;
  const hhOn = hh.length > 0 && resumeId.length > 0;

  return [
    {
      name: 'Телега',
      set: telegram.length > 0,
      ok: telegram.length > 0,
      detail: telegram.length > 0 ? (saved.telegramLabel || 'Токен активирован') : 'токена нет',
    },
    {
      name: 'Mistral',
      set: mistral.length > 0,
      ok: mistral.length > 0,
      detail: mistral.length > 0 ? (saved.mistralLabel || 'Ключ активирован') : 'ключа нет',
    },
    {
      name: 'HeadHunter',
      set: hhOn,
      ok: hhOn,
      detail: hhOn ? (saved.hhLabel || 'Токен активирован') : 'токена нет',
    },
  ];
}

async function retryAfter(res: Response): Promise<number> {
  if (res.status !== 429)
    return 0;

  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0)
    return Math.ceil(header);

  const body = await res.json().catch(() => null) as { parameters?: { retry_after?: number } } | null;
  const value = body?.parameters?.retry_after;
  if (typeof value === 'number' && value > 0)
    return value;

  return 5;
}

export async function probeTelegram(token: string): Promise<Probe> {
  if (token.length === 0)
    return { ok: false, detail: 'токена нет', retryAfter: 0 };

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (res === null)
    return { ok: false, detail: 'нет ответа', retryAfter: 0 };

  if (res.ok === false)
    return { ok: false, detail: `telegram ${res.status}`, retryAfter: await retryAfter(res) };

  const body = await res.json() as { result?: { username?: string } };
  const username = body.result?.username ?? 'бот';

  return { ok: true, detail: `активирован · @${username}`, retryAfter: 0 };
}

export async function probeMistral(key: string): Promise<Probe> {
  if (key.length === 0)
    return { ok: false, detail: 'ключа нет', retryAfter: 0 };

  const res = await fetch('https://api.mistral.ai/v1/models', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (res === null)
    return { ok: false, detail: 'нет ответа', retryAfter: 0 };

  if (res.ok === false)
    return { ok: false, detail: `mistral ${res.status}`, retryAfter: await retryAfter(res) };

  return { ok: true, detail: 'Ключ активирован', retryAfter: 0 };
}

const hhHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'user-agent': 'cursor-chrome-web (workonsunday@yandex.ru)',
  accept: 'application/json',
});

export async function probeHh(token: string, resumeId: string): Promise<Probe> {
  if (token.length === 0)
    return { ok: false, detail: 'токена нет', retryAfter: 0 };

  if (resumeId.length === 0)
    return { ok: false, detail: 'resume id нет', retryAfter: 0 };

  const res = await fetch('https://api.hh.ru/me', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: hhHeaders(token),
  }).catch(() => null);
  if (res === null)
    return { ok: false, detail: 'нет ответа', retryAfter: 0 };

  if (res.ok === false)
    return { ok: false, detail: `hh ${res.status}`, retryAfter: await retryAfter(res) };

  const resume = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: hhHeaders(token),
  }).catch(() => null);
  if (resume === null)
    return { ok: false, detail: 'резюме не открылось', retryAfter: 0 };

  if (resume.ok === false)
    return { ok: false, detail: 'резюме не открылось', retryAfter: await retryAfter(resume) };

  return { ok: true, detail: 'Токен активирован', retryAfter: 0 };
}

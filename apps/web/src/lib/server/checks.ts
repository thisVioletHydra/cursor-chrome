import { secretValue, readSecrets } from './secrets';

export type LinkStatus = {
  name: string;
  set: boolean;
  ok: boolean;
  detail: string;
};

const TIMEOUT = 8_000;

export async function checkLinks(): Promise<LinkStatus[]> {
  const saved = await readSecrets();
  const telegram = secretValue('telegramToken', saved);
  const mistral = secretValue('mistralKey', saved);
  const hh = secretValue('hhAccessToken', saved);
  const resumeId = secretValue('hhResumeId', saved);
  const [tg, mi, head] = await Promise.all([
    checkTelegram(telegram),
    checkMistral(mistral),
    checkHh(hh, resumeId),
  ]);
  return [tg, mi, head];
}

async function checkTelegram(token: string): Promise<LinkStatus> {
  if (token.length === 0)
    return { name: 'Телега', set: false, ok: false, detail: 'токена нет' };

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (res === null)
    return { name: 'Телега', set: true, ok: false, detail: 'нет ответа' };

  if (res.ok === false)
    return { name: 'Телега', set: true, ok: false, detail: `telegram ${res.status}` };

  const body = await res.json() as { result?: { username?: string } };
  const username = body.result?.username ?? 'бот';

  return { name: 'Телега', set: true, ok: true, detail: `@${username} на связи` };
}

async function checkMistral(key: string): Promise<LinkStatus> {
  if (key.length === 0)
    return { name: 'Mistral', set: false, ok: false, detail: 'ключа нет' };

  const res = await fetch('https://api.mistral.ai/v1/models', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (res === null)
    return { name: 'Mistral', set: true, ok: false, detail: 'нет ответа' };

  if (res.ok === false)
    return { name: 'Mistral', set: true, ok: false, detail: `mistral ${res.status}` };

  return { name: 'Mistral', set: true, ok: true, detail: 'аккаунт отвечает' };
}

const hhHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'user-agent': 'cursor-chrome-web (workonsunday@yandex.ru)',
  accept: 'application/json',
});

async function checkHh(token: string, resumeId: string): Promise<LinkStatus> {
  if (token.length === 0)
    return { name: 'HeadHunter', set: false, ok: false, detail: 'токена нет' };

  const res = await fetch('https://api.hh.ru/me', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: hhHeaders(token),
  }).catch(() => null);
  if (res === null)
    return { name: 'HeadHunter', set: true, ok: false, detail: 'нет ответа' };

  if (res.ok === false)
    return { name: 'HeadHunter', set: true, ok: false, detail: `hh ${res.status}` };

  if (resumeId.length === 0)
    return { name: 'HeadHunter', set: true, ok: false, detail: 'токен живой, resume id нет' };

  const resume = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: hhHeaders(token),
  }).catch(() => null);
  if (resume === null || resume.ok === false)
    return { name: 'HeadHunter', set: true, ok: false, detail: 'токен живой, резюме не открылось' };

  return { name: 'HeadHunter', set: true, ok: true, detail: 'токен и резюме на связи' };
}

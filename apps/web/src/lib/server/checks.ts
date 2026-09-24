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
  const [tg, mi, head] = await Promise.all([
    checkTelegram(telegram),
    checkMistral(mistral),
    checkHh(hh),
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

async function checkHh(token: string): Promise<LinkStatus> {
  if (token.length === 0)
    return { name: 'HeadHunter', set: false, ok: false, detail: 'токена нет' };

  const res = await fetch('https://api.hh.ru/me', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'cursor-chrome-web (workonsunday@yandex.ru)',
      accept: 'application/json',
    },
  }).catch(() => null);
  if (res === null)
    return { name: 'HeadHunter', set: true, ok: false, detail: 'нет ответа' };

  if (res.ok === false)
    return { name: 'HeadHunter', set: true, ok: false, detail: `hh ${res.status}` };

  const body = await res.json() as { email?: string; first_name?: string };
  const who = body.email || body.first_name || 'аккаунт';

  return { name: 'HeadHunter', set: true, ok: true, detail: `${who} авторизован` };
}

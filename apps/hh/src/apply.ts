import { COVER_LETTER } from './copy.ts';
import { HH_API, HH_USER_AGENT, PING_MS } from './limits.ts';

import process from 'node:process';

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

export async function accessToken(): Promise<string> {
  const ready = process.env.HH_ACCESS_TOKEN ?? '';
  if (ready.length > 0)
    return ready;

  const refresh = process.env.HH_REFRESH_TOKEN ?? '';
  const id = process.env.HH_CLIENT_ID ?? '';
  const secret = process.env.HH_CLIENT_SECRET ?? '';
  if (refresh.length === 0 || id.length === 0 || secret.length === 0)
    throw new Error('нет токена HH');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: id,
    client_secret: secret,
  });
  const res = await fetch('https://hh.ru/oauth/token', {
    method: 'POST',
    signal: AbortSignal.timeout(PING_MS),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': HH_USER_AGENT,
    },
    body,
  });
  if (res.ok === false)
    throw new Error(`hh oauth ${res.status}`);

  const json = await res.json() as TokenResponse;
  if (typeof json.access_token !== 'string' || json.access_token.length === 0)
    throw new Error('hh oauth пустой');

  process.env.HH_ACCESS_TOKEN = json.access_token;
  if (typeof json.refresh_token === 'string')
    process.env.HH_REFRESH_TOKEN = json.refresh_token;

  return json.access_token;
}

export async function sendApply(vacancyId: string): Promise<'sent' | 'limit' | 'again' | 'human'> {
  const resume = process.env.HH_RESUME_ID ?? '';
  if (resume.length === 0)
    return 'human';

  const token = await accessToken();
  const body = new URLSearchParams({
    vacancy_id: vacancyId,
    resume_id: resume,
    message: COVER_LETTER,
  });
  const res = await fetch(`${HH_API}/negotiations`, {
    method: 'POST',
    signal: AbortSignal.timeout(PING_MS),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': HH_USER_AGENT,
    },
    body,
  });
  if (res.status === 403)
    return 'again';

  if (res.status === 429)
    return 'limit';

  if (res.ok === false)
    return 'human';

  return 'sent';
}

import { HH_API, HH_USER_AGENT, PING_MS } from './limits.ts';

import process from 'node:process';

const TOKEN_URL = 'https://api.hh.ru/token';

type TokenBody = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

let cached = { id: '', token: '', until: 0 };

export async function connectApp(clientId: string, clientSecret: string): Promise<void> {
  const token = await exchangeApp(clientId, clientSecret);
  await vacancyPing(token);
}

export async function appToken(): Promise<string> {
  const id = process.env.HH_CLIENT_ID ?? '';
  const secret = process.env.HH_CLIENT_SECRET ?? '';
  if (id.length > 0 && secret.length > 0) {
    if (cached.id === id && cached.token.length > 0 && Date.now() < cached.until)
      return cached.token;

    return exchangeApp(id, secret);
  }

  return process.env.HH_ACCESS_TOKEN ?? '';
}

export async function vacancyPing(token: string): Promise<void> {
  const url = new URL(`${HH_API}/vacancies`);
  url.searchParams.set('text', 'react');
  url.searchParams.set('per_page', '1');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(PING_MS),
    headers: {
      'user-agent': HH_USER_AGENT,
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  }).catch(() => null);
  if (res === null)
    throw new Error('hh не ответил');

  if (res.status === 403)
    throw new Error('приложение не пускает к вакансиям');

  if (res.ok === false)
    throw new Error(`hh ${res.status}`);
}

async function exchangeApp(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': HH_USER_AGENT,
      accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(PING_MS),
  }).catch(() => null);
  if (res === null)
    throw new Error('hh не ответил');

  const json = await res.json().catch(() => null) as TokenBody | null;
  const token = accessToken(json);
  if (res.ok === false || token.length === 0) {
    if (json?.error === 'invalid_client')
      throw new Error('id или секрет приложения не те');

    throw new Error(`hh token ${res.status}`);
  }

  const ttl = Math.max(60, (json?.expires_in ?? 3600) - 120) * 1000;
  cached = { id: clientId, token, until: Date.now() + ttl };

  return token;
}

function accessToken(json: TokenBody | null): string {
  if (json === null || typeof json.access_token !== 'string')
    return '';

  return json.access_token;
}

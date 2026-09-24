import { HH_API, HH_USER_AGENT, PING_MS } from './limits.ts';

import process from 'node:process';

export async function ping(): Promise<void> {
  const checks = [pingHh(), pingTelegram(), pingMistral()];
  const results = await Promise.all(checks.map(check => check.then(() => '', error => String(error))));
  const failed = results.filter(item => item.length > 0);
  if (failed.length > 0) {
    console.error(failed.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log('PING');
}

async function pingHh(): Promise<void> {
  const url = new URL(`${HH_API}/vacancies`);
  url.searchParams.set('text', 'react');
  url.searchParams.set('per_page', '1');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(PING_MS),
    headers: { 'user-agent': HH_USER_AGENT, accept: 'application/json' },
  });
  if (res.ok === false)
    throw new Error(`hh ${res.status}`);
}

async function pingTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (token.length === 0)
    throw new Error('нет токена телеги');

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(PING_MS),
  });
  if (res.ok === false)
    throw new Error(`telegram ${res.status}`);
}

async function pingMistral(): Promise<void> {
  const key = process.env.MISTRAL_API_KEY ?? '';
  if (key.length === 0)
    throw new Error('нет ключа mistral');

  const res = await fetch('https://api.mistral.ai/v1/models', {
    signal: AbortSignal.timeout(PING_MS),
    headers: { authorization: `Bearer ${key}` },
  });
  if (res.ok === false)
    throw new Error(`mistral ${res.status}`);
}

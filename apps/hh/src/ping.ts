import { HH_API, HH_USER_AGENT, PING_MS } from './limits.ts';
import { mistralStatus } from './mistral.ts';

import process from 'node:process';

export async function pingReasons(): Promise<string[]> {
  const checks = [pingHh(), pingTelegram(), pingMistral()];
  const results = await Promise.all(checks.map(check => check.then(() => '', (error: unknown) => (error instanceof Error ? error.message : String(error)))));

  return results.filter(item => item.length > 0);
}

export async function ping(): Promise<void> {
  const failed = await pingReasons();
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
  }).catch(() => null);
  if (res === null)
    throw new Error('hh не ответил');

  if (res.ok === false)
    throw new Error(`hh ${res.status}`);
}

async function pingTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (token.length === 0)
    throw new Error('нет токена телеги');

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(PING_MS),
  }).catch(() => null);
  if (res === null)
    throw new Error('telegram не ответил');

  if (res.ok === false)
    throw new Error(`telegram ${res.status}`);
}

async function pingMistral(): Promise<void> {
  const key = process.env.MISTRAL_API_KEY ?? '';
  if (key.length === 0)
    throw new Error('нет ключа mistral');

  const status = await mistralStatus(key).catch(() => 0);
  if (status === 0)
    throw new Error('mistral не ответил');

  if (status === 429)
    throw new Error('mistral 429, у ключа нет плана или кончилась квота');

  if (status >= 400)
    throw new Error(`mistral ${status}`);
}

import { ping, scan } from '@cursor-chrome/hh';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const OWNER_NAME = 'rtxroman';
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const api = `https://api.telegram.org/bot${token}`;

type Update = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { username?: string };
  };
};

let offset = 0;
let stopScan: AbortController | null = null;

const ownerFile = path.join(path.dirname(process.env.HH_STORE ?? path.join(process.cwd(), 'data', 'seen.json')), 'owner.json');

async function main(): Promise<void> {
  if (token.length === 0)
    throw new Error('нет токена телеги');

  for (;;) {
    const updates = await getUpdates();
    for (const update of updates)
      await onUpdate(update);
  }
}

async function getUpdates(): Promise<Update[]> {
  const url = new URL(`${api}/getUpdates`);
  url.searchParams.set('timeout', '30');
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url);
  if (res.ok === false)
    throw new Error(`telegram ${res.status}`);

  const body = await res.json() as { result?: Update[] };

  return body.result ?? [];
}

async function onUpdate(update: Update): Promise<void> {
  offset = update.update_id + 1;
  const message = update.message;
  if (message === undefined)
    return;

  const allowed = await allow(message.chat.id, message.from?.username ?? '');
  if (allowed === false)
    return;

  const text = (message.text ?? '').trim().toLowerCase();
  if (text === 'стоп') {
    stopScan?.abort();
    stopScan = null;
    await send(message.chat.id, 'Стоп.');

    return;
  }

  if (text !== 'старт')
    return;

  if (stopScan)
    return;

  await run(message.chat.id);
}

async function run(chatId: number): Promise<void> {
  const gate = await pingQuiet();
  if (gate.length > 0) {
    await send(chatId, `Не стартую. ${gate}`);
    return;
  }

  stopScan = new AbortController();
  const live = process.env.HH_LIVE === '1';
  const query = process.env.HH_QUERY ?? 'typescript react nestjs';
  const reports = await scan({
    query,
    dry: live === false,
    live,
    signal: stopScan.signal,
  });
  stopScan = null;
  for (const report of reports)
    await send(chatId, report.line);

  if (reports.length === 0)
    await send(chatId, 'Пусто.');
}

async function allow(chatId: number, username: string): Promise<boolean> {
  const saved = await readOwner();
  if (saved === chatId)
    return true;

  if (saved !== null)
    return false;

  if (username.toLowerCase() !== OWNER_NAME)
    return false;

  await writeOwner(chatId);

  return true;
}

async function readOwner(): Promise<number | null> {
  try {
    const raw = JSON.parse(await fsPromises.readFile(ownerFile, 'utf8')) as { chatId?: number };

    return typeof raw.chatId === 'number' ? raw.chatId : null;
  }
  catch {
    return null;
  }
}

async function writeOwner(chatId: number): Promise<void> {
  await fsPromises.mkdir(path.dirname(ownerFile), { recursive: true });
  await fsPromises.writeFile(ownerFile, JSON.stringify({ chatId }));
}

async function send(chatId: number, text: string): Promise<void> {
  const res = await fetch(`${api}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (res.ok === false)
    throw new Error(`telegram send ${res.status}`);
}

async function pingQuiet(): Promise<string> {
  const before = process.exitCode;
  await ping();
  const failed = process.exitCode === 1;
  process.exitCode = before;
  return failed ? 'HH, телега или Mistral не ответили' : '';
}

await main();

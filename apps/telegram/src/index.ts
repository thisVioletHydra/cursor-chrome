import { ping, scan } from '@cursor-chrome/hh';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const OWNER_NAME = 'rtxroman';

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
let started = false;
let polling = false;
let onApply: ((item: { id: string; company: string; url: string }) => Promise<boolean>) | null = null;

export function telegramOn(): boolean {
  return polling;
}

export function setApplyGate(gate: (item: { id: string; company: string; url: string }) => Promise<boolean>): void {
  onApply = gate;
}

function token(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? '';
}

function api(): string {
  return `https://api.telegram.org/bot${token()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ownerFile = path.join(path.dirname(process.env.HH_STORE ?? path.join(process.cwd(), 'data', 'seen.json')), 'owner.json');

export function startTelegram(): void {
  if (started)
    return;

  started = true;
  void loop();
}

async function loop(): Promise<void> {
  for (;;) {
    if (token().length === 0) {
      polling = false;
      await delay(3000);
      continue;
    }

    polling = true;
    try {
      const updates = await getUpdates();
      for (const update of updates)
        await onUpdate(update);
    }
    catch (error) {
      polling = false;
      console.error(error instanceof Error ? error.message : 'telegram');
      await delay(3000);
    }
  }
}

async function getUpdates(): Promise<Update[]> {
  const updatesUrl = new URL(`${api()}/getUpdates`);
  updatesUrl.searchParams.set('timeout', '30');
  updatesUrl.searchParams.set('offset', String(offset));
  const res = await fetch(updatesUrl);
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
  if (text === '/start' || text.startsWith('/start ')) {
    await send(message.chat.id, 'Чат открыт. Кнопки снизу: старт начинает, стоп останавливает.', true);
    return;
  }

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
  for (const report of reports) {
    if (report.verdict === 'apply' && live && onApply !== null) {
      const paid = await onApply({ id: report.id, company: report.company, url: report.url });
      if (paid === false) {
        await send(chatId, 'Баланс кончился. Вакансия стоит 1 ₽.');
        break;
      }
    }

    await send(chatId, report.line);
  }

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

async function send(chatId: number, text: string, keys = false): Promise<void> {
  const res = await fetch(`${api()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(keys
        ? { reply_markup: { keyboard: [[{ text: 'старт' }, { text: 'стоп' }]], resize_keyboard: true } }
        : {}),
    }),
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

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === url.pathToFileURL(entry).href)
  startTelegram();

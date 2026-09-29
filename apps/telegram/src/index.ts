import { SEND_PER_DAY, watchDeath, WORK_FROM_HOUR, WORK_TO_HOUR, writeJsonAtomic, writeState } from '@cursor-chrome/hh';

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
let started = false;
let polling = false;
let onApply: ((item: { id: string; company: string; url: string }) => Promise<boolean>) | null = null;

export function telegramOn(): boolean {
  return polling;
}

export function setApplyGate(gate: (item: { id: string; company: string; url: string }) => Promise<boolean>): void {
  onApply = gate;
}

export async function chargeQueued(item: { id: string; company: string; url: string }): Promise<boolean> {
  if (onApply === null)
    return true;

  return onApply(item);
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

const QUIET_MS = 90_000;

type DigestRow = { kind: 'sent' | 'miss'; line: string };

const digest: DigestRow[] = [];
let quiet: ReturnType<typeof setTimeout> | undefined;

export function notifyDigest(kind: DigestRow['kind'], line: string): void {
  const text = line.trim();
  if (text.length === 0)
    return;

  digest.push({ kind, line: text });
  if (quiet)
    clearTimeout(quiet);

  quiet = setTimeout(() => {
    quiet = undefined;
    void flushDigest();
  }, QUIET_MS);
  quiet.unref?.();
}

export function startTelegram(): void {
  if (started)
    return;

  started = true;
  void loop();
}

async function flushDigest(): Promise<void> {
  if (digest.length === 0)
    return;

  const rows = digest.splice(0, digest.length);
  if (rows.length === 1) {
    await notifyOwner(rows[0].line);
    return;
  }

  const sent = rows.filter(row => row.kind === 'sent').length;
  const miss = rows.length - sent;
  await notifyOwner(`Откликов ${sent}, мимо ${miss}\n${rows.map(row => row.line).join('\n')}`);
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
    await send(message.chat.id, 'Чат открыт. Кнопки снизу: старт включает автопилот, стоп выключает.', true);
    return;
  }

  if (text === 'стоп') {
    await writeState({ auto: false });
    await send(message.chat.id, 'Стоп. Автопилот выключен, очередь расширение дорабатывает само.');

    return;
  }

  if (text !== 'старт')
    return;

  await writeState({ auto: true });
  await send(message.chat.id, `Автопилот включён. Вакансии принесёт Chrome, пока открыта вкладка hh и включён автопилот расширения. С ${WORK_FROM_HOUR}:00 до ${WORK_TO_HOUR}:00 МСК, до ${SEND_PER_DAY} откликов в день.`);
}

export function startAutopilot(): void {
  return;
}

export async function notifyOwner(text: string): Promise<void> {
  const chatId = await readOwner();
  if (chatId === null || token().length === 0)
    return;

  await send(chatId, text).catch(() => undefined);
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
  await writeJsonAtomic(ownerFile, { chatId });
}

async function send(chatId: number, text: string, keys = false): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${api()}/sendMessage`, {
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
  }
  catch {
    watchDeath('telegram', 'telegram не ответил');

    throw new Error('telegram не ответил');
  }

  if (res.ok === false) {
    watchDeath('telegram', `telegram ${res.status}`);

    throw new Error(`telegram send ${res.status}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === url.pathToFileURL(entry).href) {
  startTelegram();
  startAutopilot();
}

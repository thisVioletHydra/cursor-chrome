import { readMemory, storePath, watchDeath, WORK_FROM_HOUR, WORK_TO_HOUR, writeJsonAtomic, writeState } from '@cursor-chrome/hh';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

type Update = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type?: string };
  };
};

let offset = 0;
let started = false;
let polling = false;
let updatesBusy = false;
let ownerChat: number | null = null;
let lastPrivate: number | null = null;
let notedGap = '';
let onApply: ((item: { id: string; company: string; url: string }) => Promise<boolean>) | null = null;

export function telegramOn(): boolean {
  return polling;
}

export async function ownerSaved(): Promise<boolean> {
  return (await readOwner()) !== null;
}

export async function connectOwner(): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (token().length === 0)
    return { ok: false, detail: 'Нет токена бота.' };

  const saved = await readOwner();
  if (saved !== null)
    return { ok: true };

  if (lastPrivate !== null) {
    try {
      await writeOwner(lastPrivate);
    }
    catch {
      return { ok: false, detail: 'Чат не записался.' };
    }

    return { ok: true };
  }

  if (polling || updatesBusy)
    return { ok: false, detail: 'Личного чата нет.' };

  let updates: Update[] | null;
  try {
    updates = await takeUpdates(0);
  }
  catch {
    return { ok: false, detail: 'Личного чата нет.' };
  }

  if (updates === null)
    return { ok: false, detail: 'Личного чата нет.' };

  for (const update of updates)
    await onUpdate(update);

  if ((await readOwner()) === null)
    return { ok: false, detail: 'Личного чата нет.' };

  return { ok: true };
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

function ownerFile(): string {
  return path.join(path.dirname(storePath()), 'owner.json');
}

function legacyOwnerFile(): string {
  return path.join(process.cwd(), 'data', 'owner.json');
}

const COLLECT_MS = 120_000;
const TEXT_MAX = 4000;

// Как колонка «Когда» в админке.
const whenOf = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const statusWord = {
  sent: 'откликнулся',
  needsHuman: 'ждёт тебя',
} as const;

type VacancyStatus = keyof typeof statusWord;

type VacancyRow = {
  company: string;
  title: string;
  status: VacancyStatus;
  at: number;
  url: string;
};

const vacancyRows: VacancyRow[] = [];
let vacancyTimer: ReturnType<typeof setTimeout> | undefined;

export function notifyVacancy(row: VacancyRow): void {
  const company = row.company.trim();
  const url = row.url.trim();
  if (company.length === 0 || url.length === 0)
    return;

  if (row.status !== 'sent' && row.status !== 'needsHuman')
    return;

  if (vacancyRows.some(item => item.url === url && item.status === row.status))
    return;

  vacancyRows.push({
    company,
    title: row.title.trim(),
    status: row.status,
    at: Number.isFinite(row.at) ? row.at : Date.now(),
    url,
  });
  if (vacancyTimer !== undefined)
    return;

  // Окно с первой строки, без сдвига: пачка не копится дольше двух минут.
  vacancyTimer = setTimeout(() => {
    vacancyTimer = undefined;
    void flushVacancies();
  }, COLLECT_MS);
  vacancyTimer.unref?.();
}

function vacancyBlock(row: VacancyRow): string {
  const head = row.title.length > 0 ? `${row.company} · ${row.title}` : row.company;

  return `${head}\n${statusWord[row.status]} · ${whenOf.format(row.at)}\n${row.url}`;
}

async function flushVacancies(): Promise<void> {
  const rows = vacancyRows.splice(0, vacancyRows.length);
  let text = '';
  for (const row of rows) {
    const block = vacancyBlock(row);
    const next = text.length === 0 ? block : `${text}\n\n${block}`;
    if (text.length > 0 && next.length > TEXT_MAX) {
      await notifyOwner(text);
      text = block;
      continue;
    }

    text = next;
  }

  if (text.length > 0)
    await notifyOwner(text);
}

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
      const updates = await takeUpdates(30);
      if (updates === null) {
        await delay(200);
        continue;
      }

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

async function takeUpdates(timeout: number): Promise<Update[] | null> {
  if (updatesBusy)
    return null;

  updatesBusy = true;
  try {
    return await fetchUpdates(timeout);
  }
  finally {
    updatesBusy = false;
  }
}

async function fetchUpdates(timeout: number): Promise<Update[]> {
  const updatesUrl = new URL(`${api()}/getUpdates`);
  updatesUrl.searchParams.set('timeout', String(timeout));
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
  if (message === undefined || message.chat.type !== 'private')
    return;

  await keepPrivate(message.chat.id);

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
  const memory = await readMemory();
  await send(message.chat.id, `Автопилот включён. Вакансии принесёт Chrome, пока открыта вкладка hh и включён автопилот расширения. С ${WORK_FROM_HOUR}:00 до ${WORK_TO_HOUR}:00 МСК, до ${memory.cap} откликов в день.`);
}

export function startAutopilot(): void {
  return;
}

export async function notifyOwner(text: string): Promise<void> {
  const chatId = await readOwner();
  if (chatId === null || token().length === 0) {
    const line = chatId === null ? 'нет чата владельца' : 'нет токена бота';
    if (notedGap !== line) {
      notedGap = line;
      watchDeath('telegram', line);
    }

    return;
  }

  await send(chatId, text).catch(() => undefined);
}

async function keepPrivate(chatId: number): Promise<void> {
  lastPrivate = chatId;
  if (ownerChat === chatId)
    return;

  const saved = await readOwner();
  if (saved === chatId)
    return;

  await writeOwner(chatId);
}

async function readOwner(): Promise<number | null> {
  if (ownerChat !== null)
    return ownerChat;

  const live = await readOwnerFile(ownerFile());
  if (live !== null) {
    ownerChat = live;

    return live;
  }

  const legacy = await readOwnerFile(legacyOwnerFile());
  if (legacy === null)
    return null;

  ownerChat = legacy;
  if (legacyOwnerFile() !== ownerFile())
    await writeJsonAtomic(ownerFile(), { chatId: legacy });

  return legacy;
}

async function readOwnerFile(file: string): Promise<number | null> {
  try {
    const raw = JSON.parse(await fsPromises.readFile(file, 'utf8')) as { chatId?: number };

    return typeof raw.chatId === 'number' ? raw.chatId : null;
  }
  catch {
    return null;
  }
}

async function writeOwner(chatId: number): Promise<void> {
  await writeJsonAtomic(ownerFile(), { chatId });
  ownerChat = chatId;
  lastPrivate = chatId;
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

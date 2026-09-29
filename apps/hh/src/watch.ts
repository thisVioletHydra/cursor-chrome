import { storePath, workHours } from './memory.ts';
import { readState } from './state.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import path from 'node:path';
import process from 'node:process';

export type WatchWho = 'extension' | 'telegram' | 'server' | 'model';

export type WatchRow = {
  at: number;
  who: WatchWho;
  text: string;
  death: boolean;
};

const MAX_ROWS = 200;
const MAX_BYTES = 200_000;
const SILENCE_MS = 3 * 60_000;
const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;

let rows: WatchRow[] = [];
let pulse = { at: 0, line: '' };
let lastDeath = '';
let lastStage = '';
let silenceNoted = false;
let timer: ReturnType<typeof setInterval> | undefined;
let notify: (text: string) => Promise<void> = async () => {};
let loaded = false;
let hooks = false;

export function startWatch(send: (text: string) => Promise<void>): void {
  notify = send;
  if (loaded === false) {
    loaded = true;
    void load();
  }

  if (timer !== undefined)
    return;

  timer = setInterval(() => {
    void silence();
  }, 60_000);
  timer.unref?.();
  if (hooks)
    return;

  hooks = true;
  process.on('uncaughtException', (error) => {
    void mark('server', clip(error.message), true);
  });
  process.on('unhandledRejection', (error) => {
    const text = error instanceof Error ? error.message : 'необработанный отказ';
    void mark('server', clip(text), true);
  });
}

export function watchPulse(line: string): void {
  const text = clip(line);
  if (text.length === 0)
    return;

  pulse = { at: Date.now(), line: text };
  silenceNoted = false;
  if (text === 'я завис' || text === 'сервер молчит') {
    void mark('extension', text, true);

    return;
  }

  if (TICK.test(text))
    return;

  if (lastDeath.startsWith('extension:'))
    lastDeath = '';

  void mark('extension', text, false);
}

export function watchDeath(who: WatchWho, text: string): void {
  void mark(who, clip(text), true);
}

export function watchView(): { pulse: { at: number; line: string }; rows: WatchRow[] } {
  return {
    pulse: { at: pulse.at, line: pulse.line },
    rows: rows.slice(-40),
  };
}

async function silence(): Promise<void> {
  const state = await readState().catch(() => null);
  const live = process.env.HH_LIVE === '1';
  if (asleep(state, live)) {
    silenceNoted = false;

    return;
  }

  const stale = pulse.at === 0 || Date.now() - pulse.at > SILENCE_MS;
  if (stale === false) {
    silenceNoted = false;

    return;
  }

  if (silenceNoted)
    return;

  silenceNoted = true;
  const where = pulse.line.length > 0 ? pulse.line : 'нет пульса';
  await mark('extension', `замолчало на шаге ${where}`, true);
}

async function mark(who: WatchWho, text: string, death: boolean): Promise<void> {
  const clean = clip(text);
  if (clean.length === 0)
    return;

  const key = `${who}:${clean}`;
  if (death) {
    if (key === lastDeath)
      return;

    lastDeath = key;
  }
  else if (key === lastStage) {
    return;
  }
  else {
    lastStage = key;
  }

  rows.push({ at: Date.now(), who, text: clean, death });
  trim();
  await save();
  if (death === false || who === 'telegram')
    return;

  await notify(`${headline(who)} ${clean}. Иди чини.`).catch(() => undefined);
}

function asleep(state: { auto: boolean } | null, live: boolean): boolean {
  if (state === null || live === false)
    return true;

  return state.auto === false || workHours() === false;
}

function headline(who: WatchWho): string {
  if (who === 'server')
    return 'Сервер упал.';

  if (who === 'model')
    return 'Модель отказала.';

  return 'Расширение замолчало.';
}

function trim(): void {
  while (rows.length > MAX_ROWS)
    rows.shift();

  while (rows.length > 1 && JSON.stringify(rows).length > MAX_BYTES)
    rows.shift();
}

function file(): string {
  return path.join(path.dirname(storePath()), 'watch.json');
}

async function load(): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  let text = '';
  try {
    text = await readFile(file(), 'utf8');
  }
  catch {
    return;
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null || Array.isArray(parsed.value) === false)
    return;

  rows = parsed.value.flatMap(rowOf).slice(-MAX_ROWS);
  trim();
}

function rowOf(value: unknown): WatchRow[] {
  if (typeof value !== 'object' || value === null)
    return [];

  const row = value as Partial<WatchRow>;
  if (broken(row))
    return [];

  if (isWho(row.who) === false)
    return [];

  return [{ at: row.at, who: row.who, text: row.text.slice(0, 160), death: row.death }];
}

async function save(): Promise<void> {
  await writeJsonAtomic(file(), rows);
}

function broken(row: Partial<WatchRow>): boolean {
  if (typeof row.at !== 'number' || typeof row.text !== 'string')
    return true;

  return row.death !== true && row.death !== false;
}

function isWho(value: unknown): value is WatchRow['who'] {
  if (value === 'extension' || value === 'telegram')
    return true;

  return value === 'server' || value === 'model';
}

function clip(text: string): string {
  return text.trim().slice(0, 160);
}

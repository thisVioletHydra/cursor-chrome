import { storePath, workHours } from './memory.ts';
import { readState, writeState } from './state.ts';
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
const START_GRACE_MS = 5 * 60_000;
const HANG_BLIND_MS = 60_000;
const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;
const FROZEN_MS = 90_000;
const STEP_MAX = 80;
const STEP_PREFIX = /^(открыл|ищу|читаю|в очереди|мимо,|сервер|админка|жду|уже видели)/;
const HARD_SKIP = /^(удалёнку запрещают|удаленку запрещают|джуниор|1C или Bitrix ядром|Python основной бэк)$/i;
const SKIP_ESSAY = /вакансия требует|стек не сов|скип,|удал[её]нку запрещают|не наш стек/i;

let tickText = '';
let tickAt = 0;
let rows: WatchRow[] = [];
let pulse = { at: 0, line: '' };
const deaths = new Set<string>();
let lastStage = '';
let hangTold = false;
let silenceNoted = false;
let pilotStart = false;
let startedAt = 0;
let stepped = false;
let resumeGen = 0;
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

export async function watchPulse(line: string): Promise<boolean> {
  const text = clip(line);
  if (text.length === 0)
    return pilotStop();

  silenceNoted = false;
  const previous = pulse.line;
  if (text.startsWith('я завис') && queueWait(previous) && tickMoving()) {
    pulse = { at: Date.now(), line: previous };

    return pilotStop();
  }

  if (frozenTick(text)) {
    const mins = Math.max(1, Math.round((Date.now() - tickAt) / 60_000));
    const hang = `я завис: жду очередь, ${mins} мин`;
    pulse = { at: Date.now(), line: hang };
    await mark('extension', hang, true);

    return pilotStop();
  }

  noteTick(text);
  const step = shortStep(text);
  const kept = shortStep(previous) ? previous : '';
  pulse = { at: Date.now(), line: step ? text : kept };
  if (text.startsWith('я завис') || text === 'сервер молчит') {
    if (holdHang())
      return pilotStop();

    await mark('extension', text, true);

    return pilotStop();
  }

  if (step === false) {
    if (skipEssay(text) && echoed(text) === false)
      await mark('model', text, false);
    else if (skipEssay(text) === false)
      await mark('extension', text, false);

    return pilotStop();
  }

  if (TICK.test(text)) {
    stepped = true;

    return pilotStop();
  }

  if (text !== 'жду очередь')
    stepped = true;

  await mark('extension', text, false, true);

  return pilotStop();
}

export function watchNote(who: WatchWho, text: string): void {
  void mark(who, clip(text), false);
}

export function watchDeath(who: WatchWho, text: string): void {
  void mark(who, clip(text), true);
}

export async function watchRestart(): Promise<void> {
  resumeGen += 1;
  dropHangDeaths();
  hangTold = false;
  silenceNoted = false;
  startedAt = Date.now();
  stepped = false;
  // Свежий пульс, иначе проверка тишины сразу снова выключит автопилот.
  pulse = { at: Date.now(), line: shortStep(pulse.line) ? pulse.line : '' };
  pilotStart = true;
  try {
    await writeState({ auto: true });
  }
  catch (error) {
    pilotStart = false;
    startedAt = 0;

    throw error;
  }
}

export async function watchStop(): Promise<void> {
  pilotStart = false;
  startedAt = 0;
  stepped = false;
  await writeState({ auto: false });
}

export function takePilotStart(): boolean {
  if (pilotStart === false)
    return false;

  pilotStart = false;

  return true;
}

export function watchView(): { pulse: { at: number; line: string }; rows: WatchRow[] } {
  return {
    pulse: { at: pulse.at, line: shortStep(pulse.line) ? pulse.line : '' },
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

  if (startedAt > 0 && Date.now() - startedAt < START_GRACE_MS)
    return;

  const stale = pulse.at === 0 || Date.now() - pulse.at > SILENCE_MS;
  if (stale === false) {
    silenceNoted = false;

    return;
  }

  if (silenceNoted)
    return;

  const where = shortStep(pulse.line) ? pulse.line : 'нет пульса';
  if (queueWait(where) && frozenTick(where) === false && tickMoving())
    return;

  silenceNoted = true;

  const stuck = queueWait(where) || frozenTick(where);
  const mins = Math.max(1, Math.round((Date.now() - (tickAt || pulse.at)) / 60_000));
  const text = stuck ? `я завис: жду очередь, ${mins} мин` : `замолчало на шаге ${where}`;
  try {
    await mark('extension', text, true);
  }
  catch (error) {
    silenceNoted = false;

    throw error;
  }
}

async function pilotStop(): Promise<boolean> {
  const state = await readState().catch(() => null);

  return state !== null && state.auto === false && state.hung === true;
}

async function mark(who: WatchWho, text: string, death: boolean, stage = false): Promise<void> {
  const clean = clip(text);
  if (clean.length === 0)
    return;

  const key = `${who}:${clean}`;
  const hang = death && who === 'extension' && hangLine(clean);
  if (death) {
    if (deaths.has(key)) {
      if (hang)
        await holdPilot();

      return;
    }

    deaths.add(key);
  }
  else if (key === lastStage) {
    return;
  }
  else {
    lastStage = key;
    if (stage) {
      deaths.clear();
      hangTold = false;
    }
  }

  const tellHang = hang && hangTold === false;
  if (hang)
    hangTold = true;

  if (hang) {
    const gen = resumeGen;
    try {
      await writeState({ auto: false, hung: true });
    }
    catch (error) {
      deaths.delete(key);
      if (tellHang)
        hangTold = false;

      throw error;
    }

    if (gen !== resumeGen) {
      await writeState({ auto: true });

      return;
    }
  }

  rows.push({ at: Date.now(), who, text: clean, death });
  trim();
  await save();
  if (hang) {
    deaths.add(key);
    hangTold = true;
    if (tellHang)
      await notify('Расширение зависло. Автопилот выключен. Иди чини.').catch(() => undefined);

    return;
  }

  if (death === false || who === 'telegram')
    return;

  await notify(`${headline(who)} ${clean}. Иди чини.`).catch(() => undefined);
}

// Минуту после старта «я завис» ещё от прошлого раза. Позже он гасит, только если шаг уже был.
function holdHang(): boolean {
  if (startedAt === 0)
    return false;

  const age = Date.now() - startedAt;
  if (age < HANG_BLIND_MS)
    return true;

  return age < START_GRACE_MS && stepped === false;
}

function hangLine(text: string): boolean {
  return text.startsWith('я завис') || text.startsWith('замолчало');
}

function queueWait(text: string): boolean {
  return text === 'жду очередь' || /^жду \d+$/.test(text);
}

function noteTick(text: string): void {
  if (TICK.test(text) === false) {
    if (text !== 'жду очередь' && text.startsWith('я завис') === false) {
      tickText = '';
      tickAt = 0;
    }

    return;
  }

  if (text === tickText)
    return;

  tickText = text;
  tickAt = Date.now();
}

function tickMoving(): boolean {
  return tickAt > 0 && Date.now() - tickAt < FROZEN_MS && TICK.test(tickText);
}

function frozenTick(text: string): boolean {
  return TICK.test(text) && text === tickText && tickAt > 0 && Date.now() - tickAt >= FROZEN_MS;
}

function dropHangDeaths(): void {
  for (const key of deaths) {
    if (key.startsWith('extension:') === false)
      continue;

    if (hangLine(key.slice('extension:'.length)))
      deaths.delete(key);
  }
}

async function holdPilot(): Promise<void> {
  const tell = hangTold === false;
  if (tell)
    hangTold = true;

  const gen = resumeGen;
  const state = await readState().catch(() => null);
  if (gen !== resumeGen)
    return;

  if (state !== null && state.auto === false && state.hung === true)
    return;

  await writeState({ auto: false, hung: true });
  if (gen !== resumeGen) {
    await writeState({ auto: true });

    return;
  }

  if (tell)
    await notify('Расширение зависло. Автопилот выключен. Иди чини.').catch(() => undefined);
}

function asleep(state: { auto: boolean } | null, live: boolean): boolean {
  if (state === null || live === false)
    return true;

  if (state.auto === false)
    return true;

  if (process.env.HH_HOURS === '0')
    return false;

  return workHours() === false;
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

  const loadedRows = parsed.value.flatMap(rowOf).map(asShown).slice(-MAX_ROWS);
  const next = collapse(loadedRows);
  rows = next;
  replay();
  trim();
  if (next.length < loadedRows.length)
    await save();
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

function collapse(list: WatchRow[]): WatchRow[] {
  const seen = new Set<string>();
  const kept: WatchRow[] = [];
  for (const row of list) {
    const key = `${row.who}:${row.text}`;
    if (row.death === false) {
      seen.clear();
      kept.push(row);
      continue;
    }

    if (seen.has(key))
      continue;

    seen.add(key);
    kept.push(row);
  }

  return kept;
}

function replay(): void {
  deaths.clear();
  hangTold = false;
  lastStage = '';
  for (const row of rows) {
    const key = `${row.who}:${row.text}`;
    if (row.death === false) {
      lastStage = key;
      deaths.clear();
      hangTold = false;
      continue;
    }

    deaths.add(key);
  }
}

function shortStep(text: string): boolean {
  return text.length > 0 && text.length <= STEP_MAX && skipEssay(text) === false;
}

function skipEssay(text: string): boolean {
  if (STEP_PREFIX.test(text))
    return false;

  if (HARD_SKIP.test(text))
    return true;

  return SKIP_ESSAY.test(text);
}

function echoed(text: string): boolean {
  return rows.slice(-40).some((row) => {
    if (row.who !== 'model')
      return false;

    if (row.text === text || row.text.endsWith(`: ${text}`))
      return true;

    if (text.length < 24)
      return false;

    return row.text.includes(text.slice(0, 48));
  });
}

function asShown(row: WatchRow): WatchRow {
  if (row.who === 'extension' && row.death === false && skipEssay(row.text))
    return { ...row, who: 'model' };

  return row;
}

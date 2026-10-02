import { storePath, workHours } from '../diary/memory.ts';
import { readState, writeState } from '../diary/state.ts';
import { parseJsonLoose, writeJsonAtomic } from '../diary/store.ts';

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
const SEARCH_TICK = /^ищу вакансию, \d+ с$/;
const PAGE_TICK = /^жду страницу, \d+ с$/;
const STATE_PULSE = /^~([a-z][a-z0-9.]*)\|([^|]+)\|(-|\d+)\|(\d+)\|([a-z][a-z0-9.]*)\|([wsp])\|([01])$/;
const MODE_TAG = /^\[(?:full|light|target)\]\s+/;
const FROZEN_MS = 90_000;
const APPLY_CAP_MS = 30 * 60_000;
const STEP_MAX = 80;
const STEP_PREFIX = /^(открыл|ищу|читаю|в очереди|в список|мимо,|сервер|админка|жду|уже видели)/;
const HARD_SKIP = /^(удалёнку запрещают|удаленку запрещают|джуниор|1C или Bitrix ядром|Python основной бэк)$/i;
const SKIP_ESSAY = /вакансия требует|стек не сов|скип,|удал[её]нку запрещают|не наш стек/i;

let tickText = '';
let tickAt = 0;
let rows: WatchRow[] = [];
let pulse = { at: 0, line: '' };
const deaths = new Set<string>();
let captchaTold = false;
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
  const text = clip(line.replace(MODE_TAG, ''));
  if (text.length === 0)
    return pilotStop();

  silenceNoted = false;
  const previous = pulse.line;
  if (readingHang(text) && pulseElapsedMs(text) >= APPLY_CAP_MS) {
    const hang = 'я завис: форма отклика, 30 мин';
    pulse = { at: Date.now(), line: hang };
    await mark('extension', hang, true);

    return pilotStop();
  }

  if (text.startsWith('я завис') && (queueRestHang(text) || readingHang(text))) {
    pulse = { at: Date.now(), line: previous };

    return pilotStop();
  }

  if (frozenTick(text)) {
    if (queueWait(text)) {
      pulse = { at: Date.now(), line: text };

      return pilotStop();
    }

    const mins = Math.max(1, Math.round((Date.now() - tickAt) / 60_000));
    const hang = `я завис: ${text}, ${mins} мин`;
    pulse = { at: Date.now(), line: hang };
    await mark('extension', hang, true);

    return pilotStop();
  }

  noteTick(text);
  if (searchHang(text)) {
    pulse = { at: Date.now(), line: 'ищу вакансию' };
    await mark('extension', 'не прочиталась страница hh', false);

    return false;
  }

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

  if (tickLine(text)) {
    stepped = true;
    const last = rows[rows.length - 1];
    if (last !== undefined && last.death === false && tickLine(last.text) && last.text !== text) {
      last.text = text;
      last.at = Date.now();
      await save();
    }

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

const CAPTCHA_LINE = 'капча, позови человека';
const CAPTCHA_FIRST = 'hh показал капчу. Бот на паузе, пока не решишь её сам и не включишь бота снова.';
const CAPTCHA_AGAIN = 'hh всё ещё показывает капчу. Бот на паузе, пока не решишь её сам и не включишь бота снова.';

export async function watchRestart(): Promise<void> {
  captchaTold = false;
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

export async function watchCaptcha(again: boolean): Promise<void> {
  await watchStop();
  if (again === false && captchaTold)
    return;

  await mark('extension', CAPTCHA_LINE, false);
  const text = again ? CAPTCHA_AGAIN : CAPTCHA_FIRST;
  await notify(text);
  captchaTold = true;
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
  if (lightNap(where))
    return;

  if (applyPastCap(where, pulse.at) === false && (queueWait(where) || readingHang(where)))
    return;

  if (where.includes('ищу вакансию') || searchTick(where) || where.includes('жду страницу') || where.includes('не прочиталась')) {
    silenceNoted = true;
    try {
      await mark('extension', 'не прочиталась страница hh', false);
    }
    catch (error) {
      silenceNoted = false;

      throw error;
    }

    return;
  }

  silenceNoted = true;

  const mins = Math.max(1, Math.round((Date.now() - (tickAt || pulse.at)) / 60_000));
  const text = frozenTick(where) ? `я завис: ${where}, ${mins} мин` : `замолчало на шаге ${where}`;
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

  if (death && searchHang(clean)) {
    await mark(who, 'не прочиталась страница hh', false);

    return;
  }

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

  if (death === false) {
    const twin = twinRow(clean);
    if (twin !== null) {
      if (skipCore(clean).length > skipCore(twin.text).length) {
        twin.text = clean;
        twin.who = who;
        twin.at = Date.now();
        await save();
      }

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

  if (death === false || who !== 'server')
    return;

  await notify(`Сервер упал. ${clean}. Иди чини.`).catch(() => undefined);
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
  return text === 'жду очередь' || /^жду \d+$/.test(text) || stateHold(text);
}

function bareStep(text: string): string {
  return text.replace(/\[(?:full|light|target)\]\s+/g, '');
}

function queueRestHang(text: string): boolean {
  if (queueWait(bareStep(text)) || lightNap(text))
    return true;

  if (text.startsWith('я завис: ') === false)
    return false;

  const body = text.slice('я завис: '.length);
  const at = body.lastIndexOf(', ');
  if (at < 0)
    return false;

  return queueWait(bareStep(body.slice(0, at))) || lightNap(body.slice(0, at));
}

function lightNap(text: string): boolean {
  return text.includes('лайт, сплю час');
}

function readingHang(text: string): boolean {
  return text.includes('~apply.')
    || text.includes('чтение вакансии')
    || text.includes('читаю вакансию')
    || text.includes('открою вакансию')
    || text.includes('отправлю текст');
}

function applyPastCap(text: string, at: number): boolean {
  if (readingHang(text) === false && text.includes('форма отклика') === false)
    return false;

  if (pulseElapsedMs(text) >= APPLY_CAP_MS)
    return true;

  return at > 0 && Date.now() - at >= APPLY_CAP_MS;
}

function pulseElapsedMs(text: string): number {
  const hit = text.match(/~[a-z][a-z0-9.]*\|[^|]+\|(?:-|\d+)\|(\d+)\|[a-z][a-z0-9.]*\|[wsp]\|[01]/);
  if (hit === null)
    return 0;

  return Number(hit[1]) * 1000;
}

function searchTick(text: string): boolean {
  const kind = stateKind(text);

  return SEARCH_TICK.test(text) || PAGE_TICK.test(text) || kind === 's' || kind === 'p';
}

function tickLine(text: string): boolean {
  return secondTick(text) || searchTick(text);
}

function secondTick(text: string): boolean {
  return TICK.test(text) || stateKind(text) === 'w';
}

function stateKind(text: string): 'w' | 's' | 'p' | '' {
  const kind = STATE_PULSE.exec(text)?.[6];
  if (kind === 'w' || kind === 's' || kind === 'p')
    return kind;

  return '';
}

function stateHold(text: string): boolean {
  return STATE_PULSE.exec(text)?.[7] === '1';
}

function searchHang(text: string): boolean {
  if (text.includes('ищу вакансию') || text.includes('жду страницу') || text.includes('не прочиталась'))
    return text.startsWith('я завис') || text.startsWith('замолчало');

  return false;
}

function noteTick(text: string): void {
  if (secondTick(text) === false) {
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
  return tickAt > 0 && Date.now() - tickAt < FROZEN_MS && secondTick(tickText);
}

function frozenTick(text: string): boolean {
  return secondTick(text) && text === tickText && tickAt > 0 && Date.now() - tickAt >= FROZEN_MS;
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
  return twinRow(text) !== null;
}

function twinRow(text: string): WatchRow | null {
  const body = skipCore(text);
  if (body.length < 12)
    return null;

  const from = Math.max(0, rows.length - 40);
  for (let index = rows.length - 1; index >= from; index -= 1) {
    const row = rows[index];
    if (row === undefined || row.death)
      continue;

    const other = skipCore(row.text);
    if (other.length < 12)
      continue;

    if (body === other || body.endsWith(other) || other.endsWith(body))
      return row;
  }

  return null;
}

function skipCore(text: string): string {
  return text.replace(/^(?:[\w./-]+ · )?скип:\s*/i, '').trim();
}

function asShown(row: WatchRow): WatchRow {
  if (row.who === 'extension' && row.death === false && skipEssay(row.text))
    return { ...row, who: 'model' };

  return row;
}

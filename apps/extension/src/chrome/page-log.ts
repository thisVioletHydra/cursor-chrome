import { getSyncKey, getSyncUrl } from './apply-log';
import { getFlags, setFlags } from './flags';
import { noteHours } from './hours-flag';
import { browser } from '../browser-host';

const MAX_LINES = 12;
const STALL_MS = 90_000;
const SERVER_STALL_MS = 3 * 60_000;
const HH_URLS = ['https://hh.ru/*', 'https://*.hh.ru/*'];

const lines: string[] = [];
let armed = 0;
let notedAt = 0;
let serverWait = false;
let halted = false;
let stall: ReturnType<typeof setTimeout> | undefined;
let onHangClear: (() => Promise<boolean>) | undefined;

const STALL_LINE = new Set(['я завис', 'сервер молчит']);
const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;

export function liveLines(): string[] {
  return lines.slice();
}

export function armLiveLog(): void {
  armed += 1;
  if (armed === 1)
    notedAt = Date.now();

  planStall();
}

export function disarmLiveLog(): void {
  armed = Math.max(0, armed - 1);
  if (armed > 0)
    return;

  serverWait = false;
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
}

export async function noteServerBatch(): Promise<void> {
  serverWait = true;
  await tellPage('сервер разбирает пачку');
}

export function doneServerBatch(): void {
  serverWait = false;
  planStall();
}

export function hangHalted(): boolean {
  return halted;
}

export function clearHangHalt(): void {
  halted = false;
}

export function bindHangClear(fn: () => Promise<boolean>): void {
  onHangClear = fn;
}

export function stalling(): boolean {
  return STALL_LINE.has(lines[lines.length - 1] ?? '');
}

export function stallStep(): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (line.length === 0 || STALL_LINE.has(line) || TICK.test(line))
      continue;

    return line;
  }

  return '';
}

export function clearStuckHang(): void {
  clearHangHalt();
  while (lines.length > 0 && STALL_LINE.has(lines[lines.length - 1] ?? ''))
    lines.pop();
}

export async function forgetStuckHang(): Promise<void> {
  const had = stalling() || hangHalted();
  clearStuckHang();
  const dropped = onHangClear !== undefined ? await onHangClear() : false;
  if (had || dropped)
    await browser.runtime.sendMessage({ type: 'hang-clear' }).catch(() => {});
}

export async function haltHang(): Promise<void> {
  if (halted)
    return;

  halted = true;
  armed = 0;
  serverWait = false;
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
  if (pulseTimer !== undefined)
    clearTimeout(pulseTimer);

  pulseTimer = undefined;
  await setFlags({ autoQueue: false });
  if (onHangClear !== undefined)
    await onHangClear();
}

export async function tellPage(line: string): Promise<void> {
  if (halted)
    return;

  const text = line.trim();
  if (text.length === 0)
    return;

  notedAt = Date.now();
  if (repeatedHang(text)) {
    planStall();
    schedulePulse(text, true);

    return;
  }

  const previous = lines[lines.length - 1] ?? '';
  if (sameTick(previous, text) && lines.length > 0)
    lines[lines.length - 1] = text;
  else
    lines.push(text);

  if (lines.length > MAX_LINES)
    lines.shift();

  planStall();
  schedulePulse(text, sameTick(previous, text) === false);
  await broadcast(lines);
  if (STALL_LINE.has(text))
    await browser.runtime.sendMessage({ type: 'hang-status', step: stallStep() }).catch(() => {});
}

const STAGE: Record<string, string> = {
  читаю: 'читаю вакансию',
  быстро: 'пролистал',
  чай: 'ушёл курить',
  отвлёкся: 'отвлёкся',
  жду: 'жду очередь',
};

export async function tickPage(label: string, ms: number): Promise<void> {
  if (halted || ms <= 0)
    return;

  const stage = STAGE[label];
  if (stage !== undefined)
    await tellPage(stage);

  const steps = Math.max(1, Math.round(ms / 1000));
  const started = Date.now();
  for (let sec = 1; sec <= steps; sec++) {
    if (halted)
      return;

    await tellPage(`${label} ${sec}`);
    if (halted)
      return;

    const pause = started + Math.round(ms * sec / steps) - Date.now();
    if (pause > 0)
      await delay(pause);
  }
}

function planStall(): void {
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
  if (armed === 0 || halted)
    return;

  const limit = stallLimit();
  stall = setTimeout(() => {
    stall = undefined;
    if (armed === 0 || halted)
      return;

    if (Date.now() - notedAt < stallLimit() - 1000) {
      planStall();

      return;
    }

    void tellPage(serverWait ? 'сервер молчит' : 'я завис');
  }, limit);
}

function stallLimit(): number {
  return serverWait ? SERVER_STALL_MS : STALL_MS;
}

function repeatedHang(text: string): boolean {
  if (text !== 'я завис' && text !== 'сервер молчит')
    return false;

  return lines[lines.length - 1] === text;
}

// Сообщение во вкладку не активирует её.
async function broadcast(rows: string[]): Promise<void> {
  const tabs = await browser.tabs.query({ url: HH_URLS }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number')
      return;

    await browser.tabs.sendMessage(tab.id, { type: 'hh-log', lines: rows }).catch(() => {});
  }));
}

function sameTick(previous: string, next: string): boolean {
  const was = previous.match(TICK);
  const now = next.match(TICK);
  if (was === null || now === null)
    return false;

  return was[1] === now[1];
}

let pulseTimer: ReturnType<typeof setTimeout> | undefined;
let pulseLine = '';
let waking = false;
let onWake: (() => Promise<void>) | undefined;

export function bindPilotWake(fn: () => Promise<void>): void {
  onWake = fn;
}

function schedulePulse(line: string, now: boolean): void {
  if (halted)
    return;

  pulseLine = line;
  if (now) {
    if (pulseTimer !== undefined)
      clearTimeout(pulseTimer);

    pulseTimer = undefined;
    void postPulse(line);

    return;
  }

  if (pulseTimer !== undefined)
    return;

  pulseTimer = setTimeout(() => {
    pulseTimer = undefined;
    void postPulse(pulseLine);
  }, 2_000);
}

export async function pulseNow(): Promise<void> {
  const flags = await getFlags();
  if (halted || flags.autoQueue !== true) {
    await listenPilot();

    return;
  }

  await postPulse(lines[lines.length - 1] ?? 'жду очередь');
}

async function postPulse(line: string): Promise<void> {
  if (halted || line.trim().length === 0)
    return;

  const body = await pilotFetch('/api/pulse', {
    method: 'POST',
    body: JSON.stringify({ line }),
  });
  if (body === null)
    return;

  noteHours(body);

  if (pilotStart(body)) {
    await pilotWake();

    return;
  }

  if (stopFlag(body)) {
    await haltHang();

    return;
  }

  await forgetStuckHang();
}

async function listenPilot(): Promise<void> {
  const body = await pilotFetch('/api/queue?listen=1');
  if (body === null)
    return;

  noteHours(body);

  if (pilotStart(body) || pilotAuto(body))
    await pilotWake();
}

async function pilotWake(): Promise<void> {
  if (waking)
    return;

  waking = true;
  try {
    await forgetStuckHang();
    if (onWake !== undefined)
      await onWake();
  }
  finally {
    waking = false;
  }
}

async function pilotFetch(path: string, init?: { method: string; body: string }): Promise<unknown | null> {
  const auth = await pilotAuth();
  if (auth === null)
    return null;

  try {
    const headers: Record<string, string> = { authorization: `Bearer ${auth.key}` };
    if (init?.body !== undefined)
      headers['content-type'] = 'application/json';

    const res = await fetch(`${auth.host}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    });
    if (res.ok === false)
      return null;

    const body: unknown = await res.json();

    return body;
  }
  catch {
    return null;
  }
}

async function pilotAuth(): Promise<{ host: string; key: string } | null> {
  const raw = (await getSyncUrl()).trim();
  const key = await getSyncKey();
  if (raw.length === 0 || key.length === 0)
    return null;

  try {
    const url = new URL(raw);

    return { host: `${url.protocol}//${url.host}`, key };
  }
  catch {
    return null;
  }
}

function pilotStart(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'start' in body && body.start === true;
}

function pilotAuto(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'auto' in body && body.auto === true;
}

function stopFlag(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'stop' in body && body.stop === true;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(() => {
  void pulseNow();
}, 60_000);

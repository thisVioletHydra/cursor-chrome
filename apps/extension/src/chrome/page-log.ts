import { getSyncKey, getSyncUrl } from './apply-log';
import { getFlags } from './flags';
import { browser } from '../browser-host';

const MAX_LINES = 12;
const STALL_MS = 90_000;
const SERVER_STALL_MS = 3 * 60_000;
const HH_URLS = ['https://hh.ru/*', 'https://*.hh.ru/*'];

const lines: string[] = [];
let armed = 0;
let notedAt = 0;
let serverWait = false;
let stall: ReturnType<typeof setTimeout> | undefined;

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

export async function tellPage(line: string): Promise<void> {
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
}

export async function tickPage(label: string, ms: number): Promise<void> {
  if (ms <= 0)
    return;

  const steps = Math.max(1, Math.round(ms / 1000));
  const started = Date.now();
  for (let sec = 1; sec <= steps; sec++) {
    await tellPage(`${label} ${sec}`);
    const pause = started + Math.round(ms * sec / steps) - Date.now();
    if (pause > 0)
      await delay(pause);
  }
}

function planStall(): void {
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
  if (armed === 0)
    return;

  const limit = stallLimit();
  stall = setTimeout(() => {
    stall = undefined;
    if (armed === 0)
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

const TICK = /^(читаю|быстро|чай|отвлёкся|жду) /;

function sameTick(previous: string, next: string): boolean {
  const was = previous.match(TICK);
  const now = next.match(TICK);
  if (was === null || now === null)
    return false;

  return was[1] === now[1];
}

let pulseTimer: ReturnType<typeof setTimeout> | undefined;
let pulseLine = '';

function schedulePulse(line: string, now: boolean): void {
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
  if (flags.autoQueue !== true)
    return;

  await postPulse(lines[lines.length - 1] ?? 'жду очередь');
}

async function postPulse(line: string): Promise<void> {
  const raw = (await getSyncUrl()).trim();
  const key = await getSyncKey();
  if (raw.length === 0 || key.length === 0 || line.trim().length === 0)
    return;

  let host = '';
  try {
    const url = new URL(raw);
    host = `${url.protocol}//${url.host}`;
  }
  catch {
    return;
  }

  await fetch(`${host}/api/pulse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ line }),
  }).catch(() => undefined);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(() => {
  void pulseNow();
}, 60_000);

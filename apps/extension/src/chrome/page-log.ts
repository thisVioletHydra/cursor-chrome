import { getSyncKey, getSyncUrl } from './apply-log';
import { getFlags, setFlags } from './flags';
import { noteHours } from './hours-flag';
import { loadPace, waitMs } from './pace';
import { clearPilotLink, clearPilotPending, noteGateway, notePilotAnswer, noteServerSilent, readPilotPending, remoteStopCounts } from './pilot-link';
import { closePinnedHh } from './worker-tab';
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

const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;
const SEARCH_TICK = /^ищу вакансию, \d+ с$/;

function stallText(text: string): boolean {
  return text === 'сервер молчит' || text.startsWith('я завис');
}

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

let pilotGen = 0;
let hangLive = true;

export function bumpPilot(): void {
  pilotGen += 1;
  hangLive = false;
  lines.length = 0;
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
}

export function pilotStamp(): number {
  return pilotGen;
}

export function bindHangClear(fn: () => Promise<boolean>): void {
  onHangClear = fn;
}

export function stalling(): boolean {
  return stallText(lines[lines.length - 1] ?? '');
}

export function stallStep(): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (line.length === 0 || stallText(line) || movingTick(line))
      continue;

    return line;
  }

  return '';
}

export function clearStuckHang(): void {
  clearHangHalt();
  while (lines.length > 0 && stallText(lines[lines.length - 1] ?? ''))
    lines.pop();
}

export async function forgetStuckHang(): Promise<void> {
  const had = stalling() || hangHalted();
  clearStuckHang();
  const dropped = onHangClear !== undefined ? await onHangClear() : false;
  if (had || dropped)
    await withinMs(browser.runtime.sendMessage({ type: 'hang-clear' }).catch(() => {}), 400);
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
  await setFlags({ autoQueue: false });
  await clearPilotPending();
  await clearPilotLink();
  await closePinnedHh();
  if (onHangClear !== undefined)
    await onHangClear();
}

export async function tellPage(line: string): Promise<void> {
  if (halted)
    return;

  const text = line.trim();
  if (text.length === 0)
    return;

  if (stallText(text) && hangLive === false)
    return;

  notedAt = Date.now();
  if (stallText(text) === false)
    hangLive = true;

  if (repeatedHang(text)) {
    planStall();
    await withinMs(enqueuePulse(text), 1_000);

    return;
  }

  const previous = lines[lines.length - 1] ?? '';
  if (previous === text) {
    planStall();
    await withinMs(enqueuePulse(text), 1_000);

    return;
  }

  if (sameTick(previous, text) && lines.length > 0)
    lines[lines.length - 1] = text;
  else
    lines.push(text);

  if (lines.length > MAX_LINES)
    lines.shift();

  planStall();
  await withinMs(Promise.all([enqueuePulse(text), broadcast(lines)]), 1_000);
  if (stallText(text))
    void withinMs(browser.runtime.sendMessage({ type: 'hang-status', step: stallStep() }).catch(() => {}), 400);
}

const STAGE: Record<string, string> = {
  читаю: 'читаю вакансию',
  быстро: 'пролистал',
  чай: 'ушёл курить',
  отвлёкся: 'отвлёкся',
};

export async function tickPage(label: string, ms: number, resume: '' | 'hunt' = ''): Promise<void> {
  if (halted || ms <= 0)
    return;

  const job = await startWait(label, ms, resume);
  loopOwns = true;
  try {
    while (Date.now() < job.until && halted === false) {
      const beat = Date.now();
      await postWaitSecond();
      const pause = Math.min(1_000 - (Date.now() - beat), job.until - Date.now());
      if (pause > 0)
        await delay(pause);
    }
  }
  finally {
    if (currentWait === job)
      await clearWait();

    loopOwns = false;
  }
}

export async function waitBeforeLoad(): Promise<void> {
  const pace = await loadPace();
  await tickPage('жду', waitMs(pace.readMin, pace.readMax));
}

function planStall(): void {
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
  if (armed === 0 || halted || namedWait)
    return;

  const quiet = Date.now() - notedAt;
  const limit = stallLimit();
  stall = setTimeout(() => {
    stall = undefined;
    if (armed === 0 || halted || namedWait)
      return;

    if (Date.now() - notedAt < stallLimit() - 1000) {
      planStall();

      return;
    }

    const step = stallStep() || 'жду очередь';
    if (step === 'ищу вакансию' || step.startsWith('ищу вакансию,'))
      return;

    if (queueRestStep(step))
      return;

    const mins = Math.max(1, Math.round((Date.now() - notedAt) / 60_000));
    void tellPage(serverWait ? 'сервер молчит' : `я завис: ${step}, ${mins} мин`);
  }, Math.max(0, limit - quiet));
}

function stallLimit(): number {
  return serverWait ? SERVER_STALL_MS : STALL_MS;
}

function queueRestStep(step: string): boolean {
  return step === 'жду очередь' || /^жду \d+$/.test(step);
}

function repeatedHang(text: string): boolean {
  const last = lines[lines.length - 1] ?? '';
  if (text === 'сервер молчит')
    return last === text;

  if (text.startsWith('я завис') === false)
    return false;

  return last.startsWith('я завис');
}

// Сообщение во вкладку не активирует её. Зависший кадр не держит секунды.
async function broadcast(rows: string[]): Promise<void> {
  const tabs = await withinMs(
    browser.tabs.query({ url: HH_URLS }).catch(() => [] as chrome.tabs.Tab[]),
    400,
  );
  if (tabs === undefined)
    return;

  for (const tab of tabs) {
    if (typeof tab.id !== 'number')
      continue;

    void withinMs(browser.tabs.sendMessage(tab.id, { type: 'hh-log', lines: rows }).catch(() => {}), 400);
  }
}

function sameTick(previous: string, next: string): boolean {
  if (SEARCH_TICK.test(previous) && SEARCH_TICK.test(next))
    return true;

  const was = previous.match(TICK);
  const now = next.match(TICK);
  if (was === null || now === null)
    return false;

  return was[1] === now[1];
}

function movingTick(text: string): boolean {
  return TICK.test(text) || SEARCH_TICK.test(text);
}

let searchGen = 0;

export async function whileSearching<T>(work: () => Promise<T>): Promise<T> {
  const gen = ++searchGen;
  const started = Date.now();
  await tellPage('ищу вакансию');
  void runSearchClock(gen, started);
  try {
    return await work();
  }
  finally {
    if (searchGen === gen)
      searchGen += 1;
  }
}

async function runSearchClock(gen: number, started: number): Promise<void> {
  while (gen === searchGen && halted === false) {
    if (namedWait === false)
      await beatSearch(gen, started);

    if (gen !== searchGen || halted)
      return;

    await delay(1000);
  }
}

async function beatSearch(gen: number, started: number): Promise<void> {
  if (gen !== searchGen || halted)
    return;

  const sec = Math.max(1, Math.ceil((Date.now() - started) / 1000));
  await tellPage(`ищу вакансию, ${sec} с`);
}

let namedWait = false;
let loopOwns = false;
let queueRunning = false;
let resuming = false;
let lastSent = 0;
let waking = false;
let onWake: (() => Promise<void>) | undefined;
let onPilotSettle: (() => Promise<void>) | undefined;
let onResume: (() => void) | undefined;
let currentWait: WaitJob | null = null;

const WAIT_KEY = 'ccWait';
const IDLE_MS = 24 * 60 * 60_000;

type WaitJob = {
  label: string;
  startedAt: number;
  until: number;
  resume: '' | 'hunt';
};

export function bindPilotWake(fn: () => Promise<void>): void {
  onWake = fn;
}

export function bindPilotSettle(fn: () => Promise<void>): void {
  onPilotSettle = fn;
}

export function bindWaitResume(fn: () => void): void {
  onResume = fn;
}

export function noteQueueRunning(on: boolean): void {
  queueRunning = on;
  if (on)
    resuming = false;
}

export function settleResume(): void {
  resuming = false;
}

export async function clearWait(): Promise<void> {
  currentWait = null;
  namedWait = false;
  lastSent = 0;
  await saveWait(null);
  planStall();
}

export async function holdQueueWait(): Promise<void> {
  if (halted || queueRunning || resuming || currentWait !== null)
    return;

  const flags = await getFlags();
  if (flags.autoQueue !== true)
    return;

  const stored = await loadWait();
  if (stored !== null && stored.until > Date.now()) {
    currentWait = stored;
    namedWait = true;
    await postWaitSecond();

    return;
  }

  await startWait('жду', IDLE_MS, '');
}

function enqueuePulse(line: string): Promise<void> {
  const job = pulseChain.then(() => postPulse(line));
  pulseChain = job.then(() => undefined, () => undefined);

  return job;
}

let pulseChain: Promise<void> = Promise.resolve();

export async function pulseNow(): Promise<void> {
  if (onPilotSettle !== undefined)
    await onPilotSettle();

  const flags = await getFlags();
  if (halted || flags.autoQueue !== true) {
    await listenPilot();

    return;
  }

  await pumpWait();
  if (currentWait === null && queueRunning === false && resuming === false)
    await holdQueueWait();
}

async function pumpWait(): Promise<void> {
  if (halted)
    return;

  if (currentWait === null)
    currentWait = await loadWait();

  if (currentWait === null)
    return;

  if (Date.now() >= currentWait.until) {
    await finishWait();

    return;
  }

  namedWait = true;
  await postWaitSecond();
}

async function finishWait(): Promise<void> {
  if (loopOwns || currentWait === null || Date.now() < currentWait.until)
    return;

  const resume = currentWait.resume;
  await clearWait();
  if (resume === 'hunt') {
    resuming = true;
    onResume?.();
  }
}

async function startWait(label: string, ms: number, resume: '' | 'hunt'): Promise<WaitJob> {
  const startedAt = Date.now();
  const job: WaitJob = { label, startedAt, until: startedAt + ms, resume };
  currentWait = job;
  lastSent = 0;
  namedWait = true;
  await saveWait(job);
  const stage = STAGE[label];
  if (stage !== undefined)
    await tellPage(stage);

  await postWaitSecond();

  return job;
}

async function postWaitSecond(): Promise<void> {
  const job = currentWait;
  if (job === null || halted)
    return;

  const sec = Math.max(1, Math.ceil((Date.now() - job.startedAt) / 1000));
  if (sec === lastSent)
    return;

  lastSent = sec;
  await tellPage(`${job.label} ${sec}`);
}

async function saveWait(job: WaitJob | null): Promise<void> {
  if (job === null)
    await browser.storage.local.remove(WAIT_KEY).catch(() => {});
  else
    await browser.storage.local.set({ [WAIT_KEY]: job }).catch(() => {});
}

async function loadWait(): Promise<WaitJob | null> {
  const stored = await browser.storage.local.get(WAIT_KEY).catch(() => null);
  if (typeof stored !== 'object' || stored === null || WAIT_KEY in stored === false)
    return null;

  return waitOf(stored[WAIT_KEY]);
}

function waitOf(raw: unknown): WaitJob | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  if ('label' in raw === false || typeof raw.label !== 'string' || raw.label.length === 0)
    return null;

  if ('startedAt' in raw === false || typeof raw.startedAt !== 'number')
    return null;

  if ('until' in raw === false || typeof raw.until !== 'number' || raw.until <= raw.startedAt)
    return null;

  const resume = 'resume' in raw && raw.resume === 'hunt' ? 'hunt' : '';

  return { label: raw.label, startedAt: raw.startedAt, until: raw.until, resume };
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive')
    return;

  port.onMessage.addListener(() => {
    void pumpWait().then(() => {
      if (currentWait === null && queueRunning === false && resuming === false)
        return holdQueueWait();
    });
  });
});

async function postPulse(line: string): Promise<void> {
  if (halted || line.trim().length === 0)
    return;

  if (stallText(line) && hangLive === false)
    return;

  const stamp = pilotStamp();
  const body = await pilotFetch('/api/pulse', {
    method: 'POST',
    body: JSON.stringify({ line }),
    signal: AbortSignal.timeout(8_000),
  });
  if (body === null || stamp !== pilotStamp())
    return;

  noteHours(body);

  if (pilotStart(body)) {
    await notePilotAnswer(body);
    await pilotWake();

    return;
  }

  if (stopFlag(body) && await remoteStopCounts()) {
    await haltHang();

    return;
  }

  await notePilotAnswer(body);
  await forgetStuckHang();
}

async function listenPilot(): Promise<void> {
  const stamp = pilotStamp();
  const body = await pilotFetch('/api/queue?listen=1');
  if (body === null || stamp !== pilotStamp())
    return;

  noteHours(body);

  if ((await readPilotPending()) === 'off')
    return;

  await notePilotAnswer(body);

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

async function pilotFetch(path: string, init?: { method: string; body: string; signal?: AbortSignal }): Promise<unknown | null> {
  const auth = await pilotAuth();
  if (auth === null)
    return null;

  const stamp = pilotStamp();
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${auth.key}` };
    if (init?.body !== undefined)
      headers['content-type'] = 'application/json';

    const res = await fetch(`${auth.host}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
      signal: init?.signal ?? AbortSignal.timeout(12_000),
    });
    if (res.ok === false) {
      if (stamp === pilotStamp())
        await noteGateway(res.status);

      return null;
    }

    const body: unknown = await res.json();

    return body;
  }
  catch {
    if (stamp === pilotStamp())
      await noteServerSilent();

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

function withinMs<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(() => {
  void pulseNow();
}, 60_000);

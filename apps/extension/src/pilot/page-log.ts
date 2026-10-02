import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { foldLiveLine, liveTick, PAGE_LOAD_MS } from '../search/page-load';
import { tagLine, type RunMode } from './log-mode';
import { budgetSec, pulseHolds, stageLine, waitMark, waitPulse, type WaitMark } from './wait-pulse';
import { getFlags } from './flags';
import { noteHours } from '../apply/hours-flag';
import { loadPace, waitMs } from '../apply/pace';
import { reconcilePilot } from './pilot-heal';
import { clearPilotLink, clearPilotPending, noteGateway, notePilotAnswer, noteServerSilent, readPilotLink, readPilotPending, readServerDown, remoteStopCounts, SERVER_WAIT, askServerPush } from './pilot-link';
import { applyPilot } from './pilot-apply';
import { markPilotStop, pilotStopped } from './pilot-stop';
import { serverWaitOver } from '../chrome/pilot';
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

const HUNT_MARK = waitMark({
  id: 'search.hunt',
  human: 'ищу вакансию',
  budget: null,
  next: 'search.load',
  kind: 's',
});

const LOAD_MARK = waitMark({
  id: 'search.load',
  human: 'страница hh',
  budget: budgetSec(PAGE_LOAD_MS),
  next: 'search.read',
  kind: 'p',
});

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
  await tellPage('page-log.ts · сервер разбирает пачку');
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
    if (line.length === 0 || stallText(line) || liveTick(line))
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
  await markPilotStop();
  await applyPilot({ type: 'stop', reason: 'hang' });

  await clearPilotPending();
  await clearPilotLink();
  if (onHangClear !== undefined)
    await onHangClear();
}

let runMode: RunMode = 'full';

export function setLogMode(mode: RunMode): void {
  runMode = mode;
}

export async function tellPage(line: string): Promise<void> {
  if (halted)
    return;

  const raw = line.trim();
  if (raw.length === 0)
    return;

  const text = raw.startsWith('~') || raw === 'сервер молчит' || raw.startsWith('я завис') ? raw : tagLine(runMode, raw);

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

  const folded = foldLiveLine(lines, text);
  lines.length = 0;
  lines.push(...folded);

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

export async function tickPage(label: string, ms: number, resume: '' | 'hunt' = '', mark: WaitMark | null = null): Promise<void> {
  if (halted || ms <= 0)
    return;

  const job = await startWait(label, ms, resume, mark);
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
  const ms = waitMs(pace.readMin, pace.readMax);
  await tickPage('жду', ms, '', waitMark({
    id: 'apply.read',
    human: 'чтение вакансии',
    budget: budgetSec(ms),
    next: 'apply.open',
    hold: true,
  }));
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
    if (step.includes('ищу вакансию') || step.includes('жду загрузку') || step.includes('жду страницу') || step.includes('не прочиталась') || step.includes('лайт, сплю час'))
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
  return step === 'жду очередь' || /^жду \d+$/.test(step) || pulseHolds(step);
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

let searchGen = 0;
let pagePulse = 0;
let pageClockFrom = 0;
let loadingPage = false;

export async function whileSearching<T>(work: () => Promise<T>): Promise<T> {
  const gen = ++searchGen;
  const started = Date.now();
  await tellPage('page-log.ts · ищу вакансию');
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
    if (namedWait === false && loadingPage === false)
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
  await tellPage(waitPulse(HUNT_MARK, sec));
}

export async function loadWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  if (loadingPage)
    return withinMs(work, ms);

  const gen = ++pagePulse;
  pageClockFrom = Date.now();
  loadingPage = true;
  void runPageClock(gen, pageClockFrom);
  try {
    return await withinMs(work, ms);
  }
  finally {
    if (pagePulse === gen)
      pagePulse += 1;

    loadingPage = false;
  }
}

async function runPageClock(gen: number, started: number): Promise<void> {
  while (gen === pagePulse && halted === false) {
    const sec = Math.max(1, Math.ceil((Date.now() - started) / 1000));
    await tellPage(waitPulse(LOAD_MARK, sec));
    if (gen !== pagePulse || halted)
      return;

    await delay(1000);
  }
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
  mark: WaitMark | null;
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
  try {
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

    await startWait('жду', IDLE_MS, '', waitMark({
      id: 'queue.idle',
      human: 'очередь',
      budget: null,
      next: 'queue.wake',
      hold: true,
    }));
  }
  catch {
    currentWait = null;
    namedWait = false;
  }
}

function enqueuePulse(line: string): Promise<void> {
  const job = pulseChain.then(() => postPulse(line));
  pulseChain = job.then(() => undefined, () => undefined);

  return job;
}

let pulseChain: Promise<void> = Promise.resolve();

export async function pulseNow(): Promise<void> {
  await pokeServer();
  if (onPilotSettle !== undefined)
    await onPilotSettle();

  if (halted)
    await applyPilot({ type: 'stop', reason: 'hang' });

  let flags = await getFlags();
  if (halted === false && flags.autoQueue !== true) {
    flags = await reconcilePilot();
    if (flags.autoQueue === true && onPilotSettle !== undefined)
      await onPilotSettle();
  }

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

async function startWait(label: string, ms: number, resume: '' | 'hunt', mark: WaitMark | null = null): Promise<WaitJob> {
  const startedAt = Date.now();
  const job: WaitJob = { label, startedAt, until: startedAt + ms, resume, mark };
  currentWait = job;
  lastSent = 0;
  namedWait = true;
  await saveWait(job);
  const told = mark === null ? STAGE[label] : stageLine(mark);
  if (told !== undefined && told !== null)
    await tellPage(told);

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
  const line = job.mark === null ? `${job.label} ${sec}` : waitPulse(job.mark, sec);
  await tellPage(line);
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

  // Пауза чая крутится в живом воркере. После рестарта её не поднимаем.
  if (raw.label === 'чай')
    return null;

  if ('startedAt' in raw === false || typeof raw.startedAt !== 'number')
    return null;

  if ('until' in raw === false || typeof raw.until !== 'number' || raw.until <= raw.startedAt)
    return null;

  const resume = 'resume' in raw && raw.resume === 'hunt' ? 'hunt' : '';

  return { label: raw.label, startedAt: raw.startedAt, until: raw.until, resume, mark: storedMark(raw) };
}

function storedMark(raw: object): WaitMark | null {
  if (Object.hasOwn(raw, 'mark') === false)
    return null;

  return markValue(own(raw, 'mark'));
}

function markValue(raw: unknown): WaitMark | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const row = new Map(Object.entries(raw));
  const id = row.get('id');
  const human = row.get('human');
  const next = row.get('next');
  const kind = row.get('kind');
  if (typeof id !== 'string' || id.length === 0)
    return null;

  if (typeof human !== 'string' || human.length === 0)
    return null;

  if (typeof next !== 'string' || next.length === 0)
    return null;

  if (kind !== 'w' && kind !== 's' && kind !== 'p')
    return null;

  const budget = row.get('budget');
  if (budget !== null && budget !== undefined && (typeof budget !== 'number' || Number.isInteger(budget) === false || budget < 0))
    return null;

  return {
    id,
    human,
    budget: typeof budget === 'number' ? budget : null,
    next,
    kind,
    hold: row.get('hold') === true,
  };
}

function own(raw: object, key: string): unknown {
  if (Object.hasOwn(raw, key) === false)
    return undefined;

  for (const [name, value] of Object.entries(raw)) {
    if (name === key)
      return value;
  }

  return undefined;
}

function inWorker(): boolean {
  return typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope;
}

// Попап собирался вместе с журналом и сам гасил бота, вкладка при этом оставалась.
if (inWorker()) {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'keepalive')
      return;

    port.onMessage.addListener(() => {
      void pumpWait().then(() => {
        if (currentWait === null && queueRunning === false && resuming === false)
          return holdQueueWait();
      }).catch(() => {});
    });
  });
}

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
  if (waking || await pilotStopped())
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

const SERVER_PING_MS = 15_000;
let poking = false;

if (inWorker()) {
  setInterval(() => {
    void pulseNow();
  }, 60_000);
  setInterval(() => {
    void pokeServer();
  }, SERVER_PING_MS);
}

async function pokeServer(): Promise<void> {
  if (poking || halted)
    return;

  if ((await readPilotLink()) !== SERVER_WAIT)
    return;

  const since = await readServerDown();
  if (since === 0)
    return;

  if (serverWaitOver(since, Date.now())) {
    poking = true;
    try {
  await tellPage('page-log.ts · сервер не ответил, выключаюсь');
      await haltHang();
    }
    finally {
      poking = false;
    }

    return;
  }

  poking = true;
  try {
    const body = await pilotFetch('/api/queue?listen=1');
    if (body === null || halted)
      return;

    await clearPilotLink();
    await notePilotAnswer(body);
    if (queueRunning)
      return;

    if ((await readPilotPending()) === 'on')
      askServerPush();

    if (onPilotSettle !== undefined)
      await onPilotSettle();

    if (queueRunning || halted)
      return;

    if ((await getFlags()).autoQueue === true || pilotStart(body) || pilotAuto(body))
      await pilotWake();
  }
  finally {
    poking = false;
  }
}

import type { Hunt, QueueItem } from './admin-api';

import { fetchHunt, fetchQueue, postFound } from './admin-api';
import { getSyncKey, getSyncUrl } from './apply-log';
import { runHhApply } from './hh-apply-cmd';
import { collectVacancies } from './hh-search';
import { requireTabId } from './inject';
import { adoptHhWorker, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

type ApplyReply = { status?: string; reason?: string; hints?: unknown };

type Status = 'sent' | 'needsHuman' | 'skip';

export type QueueRun = {
  ok: boolean;
  sent: number;
  human: number;
  skipped: number;
  left: number;
  reason: string;
  lines: string[];
};

const REPORT_KEY = 'queueReport';
const SOON_KEY = 'queueSoon';
const BUSY_KEY = 'queueBusy';
const KICK_AT_KEY = 'queueKickAt';
const STOP_NOTE_KEY = 'huntStopNote';
const KICK_GAP_MS = 10 * 60_000;
const REPORT_TTL_MS = 12 * 60 * 60_000;

const PER_RUN_MIN = 2;
const PER_RUN_MAX = 3;
const PAUSE_MIN_MS = 40_000;
const PAUSE_MAX_MS = 90_000;
const PAUSED_KEY = 'pausedUntil';
const MORNING_HOUR = 9;
const LOGIN_URL = 'https://hh.ru/account/login';

const CAPTCHA = /captcha|капча/i;
const LIMIT = /максимум вакансий|лимит откликов|слишком много откликов/i;
const LOGIN = /login|войти/i;
const TEST = /тест|тестов/i;

let running = false;

export async function runQueue(): Promise<QueueRun> {
  if (running)
    return { ok: false, sent: 0, human: 0, skipped: 0, left: 0, reason: 'уже идёт', lines: [] };

  running = true;
  await browser.storage.local.set({ [BUSY_KEY]: true, [SOON_KEY]: false });
  await browser.runtime.sendMessage({ type: 'queue-busy' }).catch(() => {});
  try {
    const run = await drain();
    await rememberReport(run);

    return run;
  }
  finally {
    running = false;
    await browser.storage.local.set({ [BUSY_KEY]: false });
  }
}

export async function markSearchSoon(): Promise<void> {
  await browser.storage.local.set({ [SOON_KEY]: true });
  await browser.runtime.sendMessage({ type: 'queue-soon' }).catch(() => {});
}

export async function clearSearchSoon(): Promise<void> {
  await browser.storage.local.set({ [SOON_KEY]: false, [BUSY_KEY]: false });
}

export async function clearSearchBusy(): Promise<void> {
  await browser.storage.local.set({ [BUSY_KEY]: false });
}

export async function kickedRecently(): Promise<boolean> {
  const stored = await browser.storage.local.get(KICK_AT_KEY);
  const at = stored[KICK_AT_KEY];

  return typeof at === 'number' && Date.now() - at < KICK_GAP_MS;
}

export async function markKicked(): Promise<void> {
  await browser.storage.local.set({ [KICK_AT_KEY]: Date.now() });
}

export async function readQueueReport(): Promise<{ soon: boolean; busy: boolean; report: QueueRun | null }> {
  const stored = await browser.storage.local.get([REPORT_KEY, SOON_KEY, BUSY_KEY]);
  const raw = stored[REPORT_KEY];

  return {
    soon: stored[SOON_KEY] === true,
    busy: stored[BUSY_KEY] === true,
    report: runOf(raw),
  };
}

async function rememberReport(run: QueueRun): Promise<void> {
  await browser.storage.local.set({
    [REPORT_KEY]: {
      ok: run.ok,
      sent: run.sent,
      human: run.human,
      skipped: run.skipped,
      left: run.left,
      reason: run.reason,
      lines: run.lines,
      at: Date.now(),
    },
  });
  await browser.runtime.sendMessage({ type: 'queue-report', run }).catch(() => {});
}

export async function isPaused(): Promise<boolean> {
  return (await readPausedUntil()) !== null;
}

/** Возвращает активную паузу или null; просроченную сбрасывает. */
export async function readPausedUntil(): Promise<number | null> {
  const stored = await browser.storage.local.get(PAUSED_KEY);
  const until = stored[PAUSED_KEY];
  if (typeof until !== 'number')
    return null;

  if (until > Date.now())
    return until;

  await browser.storage.local.remove(PAUSED_KEY);

  return null;
}

async function drain(): Promise<QueueRun> {
  const base = await syncBase();
  const key = await getSyncKey();
  if (key.length === 0)
    return blank('нет ключа');

  if (base.length === 0)
    return blank('нет адреса админки');

  const hunt = await fetchHunt(base, key);
  if (hunt === null)
    return blank('админка не отдала очередь');

  const filled = await fillHunt(base, key, hunt);
  if ('stop' in filled)
    return blank(filled.stop);

  const items = hunt.want ? await fetchQueue(base, key) : hunt.items;
  if (items === null)
    return blank('админка не отдала очередь');

  if (items.length === 0)
    return blank(filled.note.length > 0 ? filled.note : 'выдача есть, в очередь ничего не встало');

  const run: QueueRun = { ok: true, sent: 0, human: 0, skipped: 0, left: items.length, reason: '', lines: [] };
  if (filled.note === 'сервер не принял вакансии')
    run.lines.push(filled.note);
  const batch = items.slice(0, batchSize());
  for (const [index, item] of batch.entries()) {
    const reply = await applyOne(item);
    run.left -= 1;
    const status = normStatus(reply.status);
    count(run, status);
    run.lines.push(`${item.company}: ${describe(status, reply)}`);

    if (status === 'needsHuman')
      await report(base, key, item, { status, hints: hintsOf(reply) });
    else if (status === 'skip')
      await report(base, key, item, { status: 'failed', reason: reply.reason || '', hints: hintsOf(reply) });

    const stop = stopReason(status, reply);
    if (stop.length > 0) {
      await pauseUntilMorning();
      await report(base, key, item, { status: 'stop', reason: stop });
      run.reason = `Стоп до утра: ${stop}`;
      break;
    }

    if (index < batch.length - 1)
      await delay(humanPause());
  }

  return run;
}

function blank(reason: string): QueueRun {
  return { ok: false, sent: 0, human: 0, skipped: 0, left: 0, reason, lines: [] };
}

async function fillHunt(base: string, key: string, hunt: Hunt): Promise<{ stop: string } | { note: string }> {
  if (hunt.want === false)
    return { note: 'сервер не просит поиск' };

  if (hunt.queries.length === 0)
    return { note: 'сервер не прислал запрос' };

  const found = await collectVacancies(hunt.queries);
  if (found.login) {
    await pauseUntilMorning();
    await tellStop(base, key, 'hh.ru просит войти (login)');

    return { stop: 'hh.ru просит войти (login)' };
  }

  if (found.cards.length === 0)
    return { note: found.reason.length > 0 ? found.reason : 'пустая выдача' };

  await browser.storage.local.remove(STOP_NOTE_KEY);
  const posted = await postFound(base, key, found.cards);
  if (posted === false)
    return { note: 'сервер не принял вакансии' };

  return { note: '' };
}

async function tellStop(base: string, key: string, reason: string): Promise<void> {
  const stored = await browser.storage.local.get(STOP_NOTE_KEY);
  if (stored[STOP_NOTE_KEY] === reason)
    return;

  try {
    const res = await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: '0', status: 'stop', reason }),
    });
    if (res.ok)
      await browser.storage.local.set({ [STOP_NOTE_KEY]: reason });
  }
  catch {
  }
}

function runOf(raw: unknown): QueueRun | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  const at = 'at' in raw && typeof raw.at === 'number' ? raw.at : 0;
  if (at === 0 || Date.now() - at > REPORT_TTL_MS)
    return null;

  const ok = 'ok' in raw ? raw.ok : undefined;
  const reason = 'reason' in raw ? raw.reason : undefined;
  if (typeof ok !== 'boolean' || typeof reason !== 'string')
    return null;

  const sent = 'sent' in raw && typeof raw.sent === 'number' ? raw.sent : 0;
  const human = 'human' in raw && typeof raw.human === 'number' ? raw.human : 0;
  const skipped = 'skipped' in raw && typeof raw.skipped === 'number' ? raw.skipped : 0;
  const left = 'left' in raw && typeof raw.left === 'number' ? raw.left : 0;
  const lines = 'lines' in raw && Array.isArray(raw.lines)
    ? raw.lines.filter((item): item is string => typeof item === 'string')
    : [];

  return { ok, sent, human, skipped, left, reason, lines };
}

async function applyOne(item: QueueItem): Promise<ApplyReply> {
  const tab = await requireWorkerTab().catch(async () => {
    await adoptHhWorker(item.url);

    return requireWorkerTab();
  });
  const tabId = requireTabId(tab);
  const loaded = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url: item.url, active: false });
  await loaded;
  await delay(800 + Math.floor(Math.random() * 3_200));

  const fresh = await browser.tabs.get(tabId).catch(() => null);
  if ((fresh?.url || '').startsWith(LOGIN_URL))
    return { status: 'skip', reason: 'hh.ru просит войти (login)' };

  const raw = await runHhApply().catch((error: unknown) => ({
    status: 'skip',
    reason: error instanceof Error ? error.message : String(error),
  }));

  return asReply(raw);
}

function normStatus(raw: string | undefined): Status {
  if (raw === 'sent' || raw === 'needsHuman')
    return raw;

  return 'skip';
}

function count(run: QueueRun, status: Status): void {
  if (status === 'sent')
    run.sent += 1;
  else if (status === 'needsHuman')
    run.human += 1;
  else
    run.skipped += 1;
}

function describe(status: Status, reply: ApplyReply): string {
  if (status === 'sent')
    return 'отправлен';

  if (status === 'needsHuman')
    return 'ждёт тебя';

  return `мимо, ${reply.reason || 'без причины'}`;
}

function hintsOf(reply: ApplyReply): string[] {
  if (Array.isArray(reply.hints) === false)
    return [];

  return reply.hints.filter((row): row is string => typeof row === 'string');
}

function stopReason(status: Status, reply: ApplyReply): string {
  const reason = reply.reason || '';
  const text = [reason, ...hintsOf(reply)].join(' ');
  const label = stopLabel(status, reason, text);
  if (label.length === 0)
    return '';

  return reason.length > 0 ? `${label}: ${reason}` : label;
}

function stopLabel(status: Status, reason: string, text: string): string {
  if (CAPTCHA.test(text))
    return 'капча';

  if (LIMIT.test(text))
    return 'лимит откликов hh';

  if (LOGIN.test(text))
    return 'слетел вход на hh.ru';

  if (status === 'needsHuman' && TEST.test(reason))
    return 'обязательный тест';

  return '';
}

async function pauseUntilMorning(): Promise<void> {
  await browser.storage.local.set({ [PAUSED_KEY]: nextMorning() });
}

function nextMorning(now = new Date()): number {
  const morning = new Date(now);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  if (morning.getTime() <= now.getTime())
    morning.setDate(morning.getDate() + 1);

  return morning.getTime();
}

function batchSize(): number {
  return PER_RUN_MIN + Math.floor(Math.random() * (PER_RUN_MAX - PER_RUN_MIN + 1));
}

function humanPause(): number {
  return PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS + 1));
}

async function report(base: string, key: string, item: QueueItem, extra: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: item.id, company: item.company, title: item.title, url: item.url, ...extra }),
    });
  }
  catch {
  }
}

export async function syncBase(): Promise<string> {
  const raw = (await getSyncUrl()).trim();
  if (raw.length === 0)
    return '';

  try {
    const url = new URL(raw);

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

function asReply(raw: unknown): ApplyReply {
  if (typeof raw !== 'object' || raw === null)
    return { status: 'skip', reason: 'нет ответа' };

  const rec = raw as Record<string, unknown>;

  return {
    status: typeof rec.status === 'string' ? rec.status : 'skip',
    reason: typeof rec.reason === 'string' ? rec.reason : '',
    hints: rec.hints,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

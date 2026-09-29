import type { Hunt, QueueItem } from './admin-api';

import { fetchHunt, fetchQueue, keepWorkHours, postFound } from './admin-api';
import { getSyncKey, getSyncUrl } from './apply-log';
import { getFlags, setFlags } from './flags';
import { pinnedCaptcha, tabShowsCaptcha } from './hh-captcha';
import { loadPace, rare, waitMs } from './pace';
import { armLiveLog, bindHangClear, bindWaitResume, clearWait, disarmLiveLog, doneServerBatch, hangHalted, holdQueueWait, noteQueueRunning, noteServerBatch, settleResume, tellPage, tickPage } from './page-log';
import { runHhApply } from './hh-apply-cmd';
import { collectVacancies } from './hh-search';
import { requireTabId } from './inject';
import { adoptHhWorker, getWorkerTabId, requireWorkerTab, waitTab } from './worker-tab';
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

const PAUSED_KEY = 'pausedUntil';
const CAPTCHA_HOLD = 'captchaHold';
const CAPTCHA_NOTE = 'captchaNote';
const MORNING_HOUR = 9;
const WORK_FROM_HOUR = 9;
const WORK_TO_HOUR = 22;
const LOGIN_URL = 'https://hh.ru/account/login';

const LIMIT = /максимум вакансий|лимит откликов|слишком много откликов/i;
const LOGIN = /login|войти/i;
const TEST = /тест|тестов/i;

let running = false;

export function queueBusy(): boolean {
  return running;
}

export async function runQueue(): Promise<QueueRun> {
  if (running)
    return blank(hangHalted() ? 'расширение зависло' : 'уже идёт');

  if (hangHalted())
    return blank('расширение зависло');

  const restart = await captchaHolding();
  if (await guardCaptcha(restart))
    return blank('капча, позови человека');

  noteQueueRunning(true);
  await clearWait();
  running = true;
  armLiveLog();
  try {
    await browser.storage.local.set({ [BUSY_KEY]: true, [SOON_KEY]: false });
    await browser.runtime.sendMessage({ type: 'queue-busy' }).catch(() => {});
    const run = await drain();
    await rememberReport(run);

    return run;
  }
  finally {
    disarmLiveLog();
    running = false;
    noteQueueRunning(false);
    await browser.storage.local.set({ [BUSY_KEY]: false });
    await holdQueueWait();
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

export async function forgetHangReport(): Promise<boolean> {
  const stored = await browser.storage.local.get(REPORT_KEY);
  const raw = stored[REPORT_KEY];
  if (typeof raw !== 'object' || raw === null)
    return false;

  const reason = 'reason' in raw && typeof raw.reason === 'string' ? raw.reason : '';
  if (reason !== 'расширение зависло')
    return false;

  await browser.storage.local.remove(REPORT_KEY);

  return true;
}

async function rememberReport(run: QueueRun): Promise<void> {
  if (run.reason === 'расширение зависло') {
    await browser.storage.local.remove(REPORT_KEY);
    await browser.runtime.sendMessage({ type: 'queue-report', run: { ...run, lines: [] } }).catch(() => {});

    return;
  }

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

  const run: QueueRun = { ok: true, sent: 0, human: 0, skipped: 0, left: 0, reason: '', lines: [] };
  let started = false;
  let advance = false;

  while (hoursOpen()) {
    if (await cycleOpen() === false) {
      if (hangHalted())
        run.reason = 'расширение зависло';

      break;
    }

    const hunt = await fetchHunt(base, key, advance);
    if (hangHalted()) {
      run.reason = 'расширение зависло';
      break;
    }

    if (hunt === null) {
      if (await restCycle() === false) {
        run.reason = 'админка не отдала очередь';
        break;
      }

      continue;
    }

    const filled = await fillHunt(base, key, hunt);
    if (hangHalted()) {
      run.reason = 'расширение зависло';
      break;
    }

    if ('stop' in filled) {
      run.reason = filled.stop;
      break;
    }

    if (filled.note.length > 0 && run.lines.includes(filled.note) === false)
      run.lines.push(filled.note);

    const applied = await applyPending(base, key, run);
    if (applied.started)
      started = true;

    if (applied.stop) {
      run.reason = applied.reason;
      break;
    }

    if (filled.more)
      continue;

    advance = filled.done;
    if (await restCycle() === false)
      break;
  }

  if (started === false) {
    if (run.reason.length > 0)
      return blank(run.reason);

    const note = run.lines.find(line => line.length > 0) ?? '';

    return blank(note.length > 0 ? note : 'выдача есть, в очередь ничего не встало');
  }

  if (run.reason.length === 0 && hoursOpen() === false)
    run.reason = 'рабочие часы закрыты';

  return run;
}

type ApplyPass = { started: boolean; stop: boolean; reason: string };

async function applyPending(base: string, key: string, run: QueueRun): Promise<ApplyPass> {
  const seen = new Set<string>();
  let started = false;

  while (hoursOpen()) {
    if (hangHalted())
      return { started, stop: true, reason: 'расширение зависло' };

    const items = await fetchQueue(base, key);
    if (hangHalted())
      return { started, stop: true, reason: 'расширение зависло' };

    if (items === null) {
      if (started === false)
        return { started, stop: true, reason: 'админка не отдала очередь' };

      return { started, stop: true, reason: 'админка не отдала очередь' };
    }

    const fresh = items.filter(item => seen.has(item.id) === false);
    if (fresh.length === 0)
      return { started, stop: false, reason: '' };

    run.left += fresh.length;
    for (const item of fresh) {
      if (hangHalted())
        return { started, stop: true, reason: 'расширение зависло' };

      if (hoursOpen() === false)
        return { started, stop: true, reason: 'рабочие часы закрыты' };

      seen.add(item.id);
      started = true;
      const reply = await applyOne(item);
      if (hangHalted()) {
        run.left -= 1;

        return { started, stop: true, reason: 'расширение зависло' };
      }

      if (captchaReply(reply)) {
        run.left -= 1;
        await holdCaptcha(false);

        return { started, stop: true, reason: 'капча, позови человека' };
      }

      run.left -= 1;
      const status = normStatus(reply.status);
      const landed = status !== 'sent' || await report(base, key, item, { status: 'sent' });
      const shown: Status = landed ? status : 'skip';
      count(run, shown);
      run.lines.push(`${item.company}: ${landed ? describe(status, reply) : 'мимо, админка не приняла отклик'}`);

      const stop = stopReason(status, reply);
      if (stop.length > 0)
        await tellPage(stop);
      else if (shown === 'sent')
        await tickPage('отвлёкся', await distractWait());
      else
        await tellPage(landed ? describe(status, reply) : 'админка не приняла отклик');

      if (status === 'needsHuman')
        await report(base, key, item, { status, hints: hintsOf(reply) });
      else if (status === 'skip')
        await report(base, key, item, { status: 'failed', reason: reply.reason || '', hints: hintsOf(reply) });

      if (stop.length > 0) {
        await pauseUntilMorning();
        await report(base, key, item, { status: 'stop', reason: stop });

        return { started, stop: true, reason: `Стоп до утра: ${stop}` };
      }
    }
  }

  return { started, stop: hoursOpen() === false, reason: hoursOpen() ? '' : 'рабочие часы закрыты' };
}

async function cycleOpen(): Promise<boolean> {
  if (hangHalted() || await isPaused())
    return false;

  const flags = await getFlags();

  return flags.autoQueue === true && hoursOpen();
}

function blank(reason: string): QueueRun {
  return { ok: false, sent: 0, human: 0, skipped: 0, left: 0, reason, lines: [] };
}

async function fillHunt(base: string, key: string, hunt: Hunt): Promise<{ stop: string } | { note: string; more: boolean; done: boolean }> {
  if (hunt.want === false)
    return { note: 'сервер не просит поиск', more: false, done: false };

  if (hunt.queries.length === 0)
    return { note: 'сервер не прислал запрос', more: false, done: false };

  const found = await collectVacancies(hunt.queries, hunt.seen);
  if (hangHalted())
    return { stop: 'расширение зависло' };

  if (found.captcha) {
    await holdCaptcha(false);

    return { stop: 'капча, позови человека' };
  }

  if (found.login) {
    await pauseUntilMorning();
    await tellStop(base, key, 'hh.ru просит войти (login)');

    return { stop: 'hh.ru просит войти (login)' };
  }

  if (found.cards.length === 0) {
    const walked = found.reason.length === 0
      || found.reason === 'нет вакансий по запросу'
      || found.reason === 'пустая выдача';

    return { note: found.reason, more: false, done: walked };
  }

  await browser.storage.local.remove(STOP_NOTE_KEY);
  const posted = await sendFound(base, key, found.cards);
  if (hangHalted())
    return { stop: 'расширение зависло' };

  if (posted.ok === false || posted.added === 0) {
    const note = posted.reason.length > 0 ? posted.reason : 'сервер не принял вакансии';
    await tellPage(note);

    return { note, more: false, done: false };
  }

  await tellPage(`в очереди ${posted.added}`);

  return { note: '', more: found.more, done: found.more === false };
}

const DOWN = 'все модели недоступны';
const RETRY_MS = 60_000;

const REST_MIN_SEC = 10;
const REST_MAX_SEC = 50;

export async function paceBeforeHunt(): Promise<void> {
  const span = REST_MAX_SEC - REST_MIN_SEC + 1;
  const sec = REST_MIN_SEC + Math.floor(Math.random() * span);
  await tickPage('жду', sec * 1000);
}

async function restCycle(): Promise<boolean> {
  if (await cycleOpen() === false)
    return false;

  if (await guardCaptcha())
    return false;

  await paceBeforeHunt();

  return cycleOpen();
}

async function sendFound(base: string, key: string, cards: unknown[]): Promise<{ ok: boolean; added: number; reason: string }> {
  await noteServerBatch();
  let posted = await postFound(base, key, cards).finally(doneServerBatch);
  if (posted.added > 0 || posted.reason.startsWith(DOWN) === false)
    return posted;

  await tellPage(posted.reason);
  await tickPage('жду', RETRY_MS);
  if (hangHalted())
    return posted;

  await noteServerBatch();
  posted = await postFound(base, key, cards).finally(doneServerBatch);

  return posted;
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
  if (hangHalted())
    return { status: 'skip', reason: 'расширение зависло' };

  const pinned = await getWorkerTabId();
  if (pinned !== null && await tabShowsCaptcha(pinned))
    return { status: 'skip', reason: 'капча' };

  const tab = await requireWorkerTab().catch(async () => {
    await adoptHhWorker(item.url);

    return requireWorkerTab();
  });
  if (hangHalted())
    return { status: 'skip', reason: 'расширение зависло' };

  const tabId = requireTabId(tab);
  if (await tabShowsCaptcha(tabId))
    return { status: 'skip', reason: 'капча' };

  const loaded = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url: item.url, active: false });
  await loaded;
  const here = await browser.tabs.get(tabId).catch(() => null);
  const opened = here?.url || '';
  if (/\/vacancy\/\d+|vacancy_response/i.test(opened) === false && await tabShowsCaptcha(tabId))
    return { status: 'skip', reason: 'капча' };

  if (/\/vacancy\/\d+|vacancy_response/i.test(opened) === false)
    return { status: 'skip', reason: 'вакансия не открылась' };

  await tellPage(`открыл ${item.title.trim() || item.id}`);
  if (await tabShowsCaptcha(tabId))
    return { status: 'skip', reason: 'капча' };

  if (await loginPage(tabId))
    return { status: 'skip', reason: 'hh.ru просит войти (login)' };

  await pacedWait();
  if (await tabShowsCaptcha(tabId))
    return { status: 'skip', reason: 'капча' };

  if (await loginPage(tabId))
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
    return reply.reason === 'вопросы работодателя, обязательные поля' ? reply.reason : 'ждёт тебя';

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

export async function guardCaptcha(again = false): Promise<boolean> {
  const seen = await pinnedCaptcha();
  if (seen === true) {
    await holdCaptcha(again && await captchaHolding());

    return true;
  }

  if (seen === null && await captchaHolding()) {
    await pauseUntilMorning();
    await setFlags({ autoQueue: false });

    return true;
  }

  if (seen === false && await captchaHolding())
    await clearCaptchaHold();

  return false;
}

export async function captchaHolding(): Promise<boolean> {
  const stored = await browser.storage.local.get(CAPTCHA_HOLD);

  return stored[CAPTCHA_HOLD] === true;
}

async function clearCaptchaHold(): Promise<void> {
  const stored = await browser.storage.local.get(CAPTCHA_HOLD);
  if (stored[CAPTCHA_HOLD] !== true)
    return;

  await browser.storage.local.remove([CAPTCHA_HOLD, CAPTCHA_NOTE, PAUSED_KEY]);
}

async function holdCaptcha(again: boolean): Promise<void> {
  await pauseUntilMorning();
  await setFlags({ autoQueue: false });
  await browser.storage.local.set({ [CAPTCHA_HOLD]: true });
  await postCaptcha(again);
}

async function postCaptcha(again: boolean): Promise<void> {
  if (again === false) {
    const stored = await browser.storage.local.get(CAPTCHA_NOTE);
    if (stored[CAPTCHA_NOTE] === 'sent')
      return;
  }

  const base = await syncBase();
  const key = await getSyncKey();
  if (base.length === 0 || key.length === 0)
    return;

  const ok = await sendCaptcha(base, key, again);
  if (ok === false && again === false)
    await sendCaptcha(base, key, again);
}

async function sendCaptcha(base: string, key: string, again: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: '0', status: 'stop', captcha: true, again }),
    });
    if (res.ok === false)
      return false;

    if (again === false)
      await browser.storage.local.set({ [CAPTCHA_NOTE]: 'sent' });

    return true;
  }
  catch {
    return false;
  }
}

function captchaReply(reply: ApplyReply): boolean {
  if ((reply.reason || '') === 'капча')
    return true;

  return hintsOf(reply).includes('капча');
}

function nextMorning(now = new Date()): number {
  const morning = new Date(now);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  if (morning.getTime() <= now.getTime())
    morning.setDate(morning.getDate() + 1);

  return morning.getTime();
}

function hoursOpen(now = new Date()): boolean {
  if (keepWorkHours() === false)
    return true;

  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const hour = Number(text);

  return hour >= WORK_FROM_HOUR && hour < WORK_TO_HOUR;
}

async function pacedWait(): Promise<void> {
  const pace = await loadPace();
  if (rare(pace.teaEvery))
    await tickPage('чай', waitMs(pace.teaMin, pace.teaMax));

  const fast = rare(pace.fastEvery);
  const wait = fast
    ? waitMs(pace.fastMin, pace.fastMax)
    : waitMs(pace.readMin, pace.readMax);
  await tickPage(fast ? 'быстро' : 'читаю', wait);
}

async function distractWait(): Promise<number> {
  const pace = await loadPace();

  return waitMs(pace.distractMin, pace.distractMax);
}

async function loginPage(tabId: number): Promise<boolean> {
  const fresh = await browser.tabs.get(tabId).catch(() => null);

  return (fresh?.url || '').startsWith(LOGIN_URL);
}

async function report(base: string, key: string, item: QueueItem, extra: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: item.id, company: item.company, title: item.title, url: item.url, ...extra }),
    });

    return res.ok;
  }
  catch {
    return false;
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

bindHangClear(forgetHangReport);
bindWaitResume(() => {
  void resumeHunt();
});

async function resumeHunt(): Promise<void> {
  try {
    if (hangHalted() || await isPaused())
      return;

    const flags = await getFlags();
    if (flags.autoQueue !== true)
      return;

    await runQueue();
  }
  finally {
    settleResume();
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

import { getSyncKey, getSyncUrl } from './apply-log';
import { runHhApply } from './hh-apply-cmd';
import { requireTabId } from './inject';
import { adoptHhWorker, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';
import { setCoverLetter } from '../hh/letter';

type QueueItem = { id: string; company: string; title: string; url: string };

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

const PER_RUN = 3;
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
  try {
    return await drain();
  }
  finally {
    running = false;
  }
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
  if (base.length === 0 || key.length === 0)
    return { ok: false, sent: 0, human: 0, skipped: 0, left: 0, reason: 'нет адреса или ключа админки', lines: [] };

  const items = await fetchQueue(base, key);
  if (items === null)
    return { ok: false, sent: 0, human: 0, skipped: 0, left: 0, reason: 'админка не отдала очередь', lines: [] };

  if (items.length === 0)
    return { ok: true, sent: 0, human: 0, skipped: 0, left: 0, reason: 'очередь пустая', lines: [] };

  const run: QueueRun = { ok: true, sent: 0, human: 0, skipped: 0, left: items.length, reason: '', lines: [] };
  const batch = items.slice(0, PER_RUN);
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

async function applyOne(item: QueueItem): Promise<ApplyReply> {
  const tab = await requireWorkerTab().catch(async () => {
    await adoptHhWorker(item.url);

    return requireWorkerTab();
  });
  const tabId = requireTabId(tab);
  const loaded = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url: item.url, active: false });
  await loaded;

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

function humanPause(): number {
  return PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS + 1));
}

async function fetchQueue(base: string, key: string): Promise<QueueItem[] | null> {
  try {
    const res = await fetch(`${base}/api/queue`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok === false)
      return null;

    const body = await res.json() as { items?: unknown; letter?: unknown };
    if (typeof body.letter === 'string')
      await setCoverLetter(body.letter);

    if (Array.isArray(body.items) === false)
      return [];

    return body.items.filter(isItem);
  }
  catch {
    return null;
  }
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

function isItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null)
    return false;

  const row = value as Record<string, unknown>;

  return typeof row.id === 'string' && typeof row.url === 'string' && typeof row.company === 'string' && typeof row.title === 'string';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

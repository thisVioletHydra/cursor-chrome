import { getSyncKey, getSyncUrl } from './apply-log';
import { runHhApply } from './hh-apply-cmd';
import { requireTabId } from './inject';
import { adoptHhWorker, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

type QueueItem = { id: string; company: string; title: string; url: string };

type ApplyReply = { status?: string; reason?: string; hints?: unknown };

export type QueueRun = {
  ok: boolean;
  sent: number;
  human: number;
  skipped: number;
  left: number;
  reason: string;
  lines: string[];
};

const PAUSE_MS = 4_000;
const PER_RUN = 10;

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
  for (const item of items.slice(0, PER_RUN)) {
    const reply = await applyOne(item);
    run.left -= 1;
    const status = reply.status === 'sent' ? 'sent' : reply.status === 'needsHuman' ? 'needsHuman' : 'skip';
    if (status === 'sent')
      run.sent += 1;
    else if (status === 'needsHuman')
      run.human += 1;
    else
      run.skipped += 1;

    run.lines.push(`${item.company}: ${status === 'sent' ? 'отправлен' : status === 'needsHuman' ? 'ждёт тебя' : `мимо, ${reply.reason || 'без причины'}`}`);
    if (status === 'needsHuman')
      await report(base, key, item, status, reply);

    if (status === 'needsHuman' && /captcha|капча/i.test(reply.reason || '')) {
      run.reason = 'капча, дальше сам';
      break;
    }

    await delay(PAUSE_MS);
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

  const raw = await runHhApply().catch((error: unknown) => ({
    status: 'skip',
    reason: error instanceof Error ? error.message : String(error),
  }));

  return asReply(raw);
}

async function fetchQueue(base: string, key: string): Promise<QueueItem[] | null> {
  try {
    const res = await fetch(`${base}/api/queue`, { headers: { authorization: `Bearer ${key}` } });
    if (res.ok === false)
      return null;

    const body = await res.json() as { items?: unknown };
    if (Array.isArray(body.items) === false)
      return [];

    return body.items.filter(isItem);
  }
  catch {
    return null;
  }
}

async function report(base: string, key: string, item: QueueItem, status: 'needsHuman', reply: ApplyReply): Promise<void> {
  const hints = Array.isArray(reply.hints) ? reply.hints.filter((row): row is string => typeof row === 'string') : [];
  try {
    await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ vacancyId: item.id, status, company: item.company, title: item.title, url: item.url, hints }),
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

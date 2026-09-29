import { browser } from '../browser-host';

export type ApplyStatus = 'sent' | 'needsHuman';

export type ApplyRecord = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  sentAt: number;
  status?: ApplyStatus;
  hints?: string[];
};

const LOG_KEY = 'applyLog';
const DISMISS_KEY = 'applyWaitDismiss';
const SYNC_KEY = 'applySyncUrl';
const SYNC_TOKEN_KEY = 'applySyncKey';
const MIN_SYNC_KEY = 16;
const MAX = 200;

const FOOTER_LABELS = new Set([
  'наши вакансии',
  'о компании',
  'вакансии компании',
]);

function normLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFooterLabel(value: string): boolean {
  const key = normLabel(value);
  if (key.length === 0)
    return false;

  if (FOOTER_LABELS.has(key))
    return true;

  return key === 'перейти к вакансии' || key.startsWith('перейти к вакансии');
}

/** HH footer/chrome — reject if title OR company matches. */
export function isJunkApply(item: { title: string; company: string }): boolean {
  const title = item.title.trim();
  const company = item.company.trim();

  if (title.length === 0)
    return true;

  if (isFooterLabel(title) || isFooterLabel(company))
    return true;

  if (/^вакансия\s+.+\s+в\s+\S+/i.test(title))
    return true;

  return false;
}

function halfJunk(title: string, company: string): boolean {
  const titleJunk = title.length > 0 && isJunkApply({ title, company: '' });
  const companyJunk = company.length > 0 && isJunkApply({ title: 'ok', company });

  return titleJunk || companyJunk;
}

export async function appendApply(record: ApplyRecord): Promise<ApplyRecord[]> {
  const title = record.title.trim();
  const company = record.company.trim();

  if (halfJunk(title, company))
    return listApplies();

  const safeTitle = title.length > 0 ? title : record.vacancyId;
  const safeCompany = company;
  if (safeTitle.length === 0 && safeCompany.length === 0)
    return listApplies();

  if (isJunkApply({ title: safeTitle, company: safeCompany }))
    return listApplies();

  const normalized: ApplyRecord = { ...record, title: safeTitle, company: safeCompany };
  const log = await listApplies();
  if (applyStatus(normalized) === 'needsHuman' && await isWaitDismissed(normalized))
    return log;

  const sameDay = dayKey(normalized.sentAt);
  const dup = log.some((item) => {
    if (applyStatus(item) !== applyStatus(normalized))
      return false;

    if (normalized.vacancyId.length > 0 && item.vacancyId === normalized.vacancyId)
      return true;

    if (dayKey(item.sentAt) !== sameDay)
      return false;

    return normalized.vacancyId.length === 0
      && normalized.title.length > 0
      && item.title === normalized.title
      && item.company === normalized.company;
  });
  if (dup)
    return log;

  const next = [normalized, ...log].slice(0, MAX);
  await browser.storage.local.set({ [LOG_KEY]: next });
  if (applyStatus(normalized) === 'sent')
    void pushRemote(normalized);

  return next;
}

export async function listApplies(): Promise<ApplyRecord[]> {
  const stored = await browser.storage.local.get(LOG_KEY);
  const raw = stored[LOG_KEY];
  if (Array.isArray(raw) === false)
    return [];

  const all = raw.filter(isApplyRecord);
  const clean = uniqueByVacancy(all.filter(item => isJunkApply(item) === false));
  if (clean.length !== all.length)
    await browser.storage.local.set({ [LOG_KEY]: clean });

  return clean;
}

export async function todayCount(now = Date.now()): Promise<number> {
  const key = dayKey(now);
  const log = await listApplies();

  return log.filter(item =>
    dayKey(item.sentAt) === key
    && applyStatus(item) === 'sent'
    && isJunkApply(item) === false).length;
}

export function waitingHuman(log: ApplyRecord[]): ApplyRecord[] {
  const sent = new Set(
    log.filter(item => applyStatus(item) === 'sent' && item.vacancyId.length > 0).map(item => item.vacancyId),
  );
  const seen = new Set<string>();

  return log.filter((item) => {
    if (applyStatus(item) !== 'needsHuman')
      return false;

    if (item.title.length === 0 && item.company.length === 0 && item.vacancyId.length === 0)
      return false;

    if (item.vacancyId.length === 0)
      return true;

    if (sent.has(item.vacancyId) || seen.has(item.vacancyId))
      return false;

    seen.add(item.vacancyId);

    return true;
  });
}

function uniqueByVacancy(log: ApplyRecord[]): ApplyRecord[] {
  const seen = new Set<string>();

  return log.filter((item) => {
    if (item.vacancyId.length === 0)
      return true;

    const key = `${applyStatus(item)}:${item.vacancyId}`;
    if (seen.has(key))
      return false;

    seen.add(key);

    return true;
  });
}

export function applyStatus(item: ApplyRecord): ApplyStatus {
  return item.status === 'needsHuman' ? 'needsHuman' : 'sent';
}

export type WaitingKey = {
  vacancyId: string;
  sentAt: number;
  title: string;
  company: string;
};

function waitDismissKey(item: WaitingKey): string {
  if (item.vacancyId.length > 0)
    return `id:${item.vacancyId}`;

  return `row:${item.sentAt}|${item.title}|${item.company}`;
}

async function readDismissed(): Promise<string[]> {
  const stored = await browser.storage.local.get(DISMISS_KEY);
  const raw = stored[DISMISS_KEY];
  if (Array.isArray(raw) === false)
    return [];

  return raw.filter((item): item is string => typeof item === 'string');
}

async function writeDismissed(keys: string[]): Promise<void> {
  const next = [...new Set(keys)].slice(-MAX);
  await browser.storage.local.set({ [DISMISS_KEY]: next });
}

async function isWaitDismissed(item: WaitingKey): Promise<boolean> {
  const keys = await readDismissed();

  return keys.includes(waitDismissKey(item));
}

export async function forgetWaitDismiss(vacancyId: string): Promise<void> {
  if (vacancyId.length === 0)
    return;

  const keys = await readDismissed();
  const drop = `id:${vacancyId}`;
  if (keys.includes(drop) === false)
    return;

  await writeDismissed(keys.filter(key => key !== drop));
}

async function rememberDismiss(items: WaitingKey[]): Promise<void> {
  if (items.length === 0)
    return;

  const keys = await readDismissed();
  await writeDismissed([...keys, ...items.map(waitDismissKey)]);
}

function isWaitingTarget(item: ApplyRecord, target: WaitingKey): boolean {
  if (applyStatus(item) !== 'needsHuman')
    return false;

  if (target.vacancyId.length > 0)
    return item.vacancyId === target.vacancyId;

  return item.vacancyId.length === 0
    && item.sentAt === target.sentAt
    && item.title === target.title
    && item.company === target.company;
}

export async function dropWaiting(target: WaitingKey): Promise<void> {
  const log = await listApplies();
  const hit = log.filter(item => isWaitingTarget(item, target));
  if (hit.length === 0)
    return;

  await rememberDismiss(hit);
  await browser.storage.local.set({
    [LOG_KEY]: log.filter(item => isWaitingTarget(item, target) === false),
  });
}

export async function clearWaiting(): Promise<void> {
  const log = await listApplies();
  const waiting = waitingHuman(log);
  if (waiting.length === 0)
    return;

  await rememberDismiss(waiting);
  const drop = new Set(waiting);
  await browser.storage.local.set({
    [LOG_KEY]: log.filter(item => drop.has(item) === false),
  });
}

export async function sweepDismissedWaiting(): Promise<void> {
  const keys = new Set(await readDismissed());
  if (keys.size === 0)
    return;

  const log = await listApplies();
  const next = log.filter((item) => {
    if (applyStatus(item) !== 'needsHuman')
      return true;

    return keys.has(waitDismissKey(item)) === false;
  });
  if (next.length !== log.length)
    await browser.storage.local.set({ [LOG_KEY]: next });
}

type StoredSync = { url: string; key: string };

function connectLinkParts(raw: string): { origin: string; key: string } | null {
  try {
    const link = new URL(raw.trim());
    const path = link.pathname.replace(/\/+$/, '');
    if (path !== '/connect')
      return null;

    const key = decodeURIComponent(link.hash.replace(/^#/, '')).trim();

    return { origin: `${link.protocol}//${link.host}`, key };
  }
  catch {
    return null;
  }
}

async function readStoredSync(): Promise<StoredSync> {
  const stored = await browser.storage.local.get([SYNC_KEY, SYNC_TOKEN_KEY]);
  const url = stored[SYNC_KEY];
  const key = stored[SYNC_TOKEN_KEY];

  return {
    url: typeof url === 'string' ? url : '',
    key: typeof key === 'string' ? key : '',
  };
}

async function healStoredSync(): Promise<StoredSync> {
  const current = await readStoredSync();
  const parts = connectLinkParts(current.url);
  if (parts === null)
    return current;

  const key = current.key.length > 0
    ? current.key
    : (parts.key.length >= MIN_SYNC_KEY ? parts.key : '');
  if (key !== current.key && key.length > 0)
    await setSyncKey(key);

  if (parts.origin !== current.url)
    await setSyncUrl(parts.origin);

  return { url: parts.origin, key };
}

let healing: Promise<StoredSync> | null = null;

function settledSync(): Promise<StoredSync> {
  if (healing === null) {
    healing = healStoredSync().finally(() => {
      healing = null;
    });
  }

  return healing;
}

export async function getSyncUrl(): Promise<string> {
  const sync = await settledSync();

  return sync.url;
}

export async function setSyncUrl(url: string): Promise<void> {
  const parts = connectLinkParts(url);
  const next = parts === null ? url.trim() : parts.origin;
  if (parts !== null && parts.key.length >= MIN_SYNC_KEY) {
    const stored = await readStoredSync();
    if (stored.key.length === 0)
      await setSyncKey(parts.key);
  }

  await browser.storage.local.set({ [SYNC_KEY]: next });
}

export async function getSyncKey(): Promise<string> {
  const sync = await settledSync();

  return sync.key;
}

export async function setSyncKey(key: string): Promise<void> {
  await browser.storage.local.set({ [SYNC_TOKEN_KEY]: key.trim() });
}

function isApplyRecord(value: unknown): value is ApplyRecord {
  if (!value || typeof value !== 'object')
    return false;

  const rec = value as Record<string, unknown>;
  const statusOk = rec.status === undefined || rec.status === 'sent' || rec.status === 'needsHuman';
  const hintsOk = rec.hints === undefined || (Array.isArray(rec.hints) && rec.hints.every(item => typeof item === 'string'));

  return typeof rec.title === 'string'
    && typeof rec.company === 'string'
    && typeof rec.url === 'string'
    && typeof rec.vacancyId === 'string'
    && typeof rec.sentAt === 'number'
    && statusOk
    && hintsOk;
}

export function dayKey(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

async function pushRemote(record: ApplyRecord): Promise<void> {
  const raw = (await getSyncUrl()).trim();
  const key = await getSyncKey();
  if (raw.length === 0 || key.length === 0)
    return;

  let base = '';
  try {
    const url = new URL(raw);
    base = `${url.protocol}//${url.host}`;
  }
  catch {
    return;
  }

  try {
    await fetch(`${base}/api/applied`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        vacancyId: record.vacancyId,
        status: applyStatus(record),
        company: record.company,
        title: record.title,
        url: record.url,
        hints: record.hints ?? [],
      }),
    });
  }
  catch {
  }
}

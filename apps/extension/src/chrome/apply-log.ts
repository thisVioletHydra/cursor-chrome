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
const SYNC_KEY = 'applySyncUrl';
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

export async function appendApply(record: ApplyRecord): Promise<ApplyRecord[]> {
  const title = record.title.trim();
  const company = record.company.trim();

  if ((title.length > 0 && isJunkApply({ title, company: '' }))
    || (company.length > 0 && isJunkApply({ title: 'ok', company })))
    return listApplies();

  const safeTitle = title.length > 0 ? title : record.vacancyId;
  const safeCompany = company;
  if (safeTitle.length === 0 && safeCompany.length === 0)
    return listApplies();

  if (isJunkApply({ title: safeTitle, company: safeCompany }))
    return listApplies();

  const normalized: ApplyRecord = { ...record, title: safeTitle, company: safeCompany };
  const log = await listApplies();
  const sameDay = dayKey(normalized.sentAt);
  const dup = log.some((item) => {
    if (dayKey(item.sentAt) !== sameDay)
      return false;

    if (applyStatus(item) !== applyStatus(normalized))
      return false;

    if (normalized.vacancyId && item.vacancyId === normalized.vacancyId)
      return true;

    return normalized.vacancyId.length === 0
      && normalized.title.length > 0
      && item.title === normalized.title
      && item.company === normalized.company;
  });
  if (dup)
    return log;

  const next = [normalized, ...log].slice(0, MAX);
  await chrome.storage.local.set({ [LOG_KEY]: next });
  if (applyStatus(normalized) === 'sent')
    void pushRemote(normalized);

  return next;
}

export async function listApplies(): Promise<ApplyRecord[]> {
  const stored = await chrome.storage.local.get(LOG_KEY);
  const raw = stored[LOG_KEY];
  if (Array.isArray(raw) === false)
    return [];

  const all = raw.filter(isApplyRecord);
  const clean = all.filter(item => isJunkApply(item) === false);
  if (clean.length !== all.length)
    await chrome.storage.local.set({ [LOG_KEY]: clean });

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

  return log.filter((item) => {
    if (applyStatus(item) !== 'needsHuman')
      return false;

    if (item.title.length === 0 && item.company.length === 0 && item.vacancyId.length === 0)
      return false;

    return item.vacancyId.length === 0 || sent.has(item.vacancyId) === false;
  });
}

export function applyStatus(item: ApplyRecord): ApplyStatus {
  return item.status === 'needsHuman' ? 'needsHuman' : 'sent';
}

export async function getSyncUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  const url = stored[SYNC_KEY];

  return typeof url === 'string' ? url : '';
}

export async function setSyncUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [SYNC_KEY]: url.trim() });
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
  const url = await getSyncUrl();
  if (url.length === 0)
    return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    });
  }
  catch {
  }
}

export type ApplyRecord = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
  sentAt: number;
};

const LOG_KEY = 'applyLog';
const SYNC_KEY = 'applySyncUrl';
const MAX = 200;

export async function appendApply(record: ApplyRecord): Promise<ApplyRecord[]> {
  const log = await listApplies();
  const sameDay = dayKey(record.sentAt);
  const dup = log.some((item) => {
    if (dayKey(item.sentAt) !== sameDay)
      return false;

    if (record.vacancyId && item.vacancyId === record.vacancyId)
      return true;

    return record.vacancyId.length === 0
      && record.title.length > 0
      && item.title === record.title
      && item.company === record.company;
  });
  if (dup)
    return log;

  const next = [record, ...log].slice(0, MAX);
  await chrome.storage.local.set({ [LOG_KEY]: next });
  void pushRemote(record);

  return next;
}

export async function listApplies(): Promise<ApplyRecord[]> {
  const stored = await chrome.storage.local.get(LOG_KEY);
  const raw = stored[LOG_KEY];
  if (Array.isArray(raw) === false)
    return [];

  return raw.filter(isApplyRecord);
}

export async function todayCount(now = Date.now()): Promise<number> {
  const key = dayKey(now);
  const log = await listApplies();

  return log.filter(item => dayKey(item.sentAt) === key).length;
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

  return typeof rec.title === 'string'
    && typeof rec.company === 'string'
    && typeof rec.url === 'string'
    && typeof rec.vacancyId === 'string'
    && typeof rec.sentAt === 'number';
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

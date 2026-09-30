import { getSyncKey } from './apply-log';
import { getFlags } from './flags';
import { tabShowsCaptcha } from './hh-captcha';
import { requireTabId } from './inject';
import { captchaHolding, syncBase } from './queue-run';
import { adoptHhWorker, getWorkerTabId, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

export type NegotiationState = 'invitation' | 'discard' | 'response';

export type NegotiationItem = {
  vacancyId: string;
  state: NegotiationState;
  employer: string;
  title: string;
  url: string;
  updatedAt: number;
};

export type NegotiationsSync = { ok: boolean; count: number; reason: string };

const NEGOTIATIONS_ALL = 'https://hh.ru/applicant/negotiations?state=all';
const NEGOTIATIONS = 'https://hh.ru/applicant/negotiations';
const LOGIN_URL = 'https://hh.ru/account/login';
const RENDER_WAIT_MS = 1_500;

export async function syncNegotiations(): Promise<NegotiationsSync> {
  if (await captchaHolding())
    return { ok: true, count: 0, reason: '' };

  const pinned = await getWorkerTabId();
  if (pinned !== null && await tabShowsCaptcha(pinned))
    return { ok: true, count: 0, reason: '' };

  const base = await syncBase();
  const key = await getSyncKey();
  if (base.length === 0 || key.length === 0)
    return { ok: false, count: 0, reason: 'нет адреса или ключа админки' };

  let items: NegotiationItem[];
  try {
    const tabId = await workerTabId();
    items = await collect(tabId, NEGOTIATIONS_ALL);
    if (items.length === 0)
      items = await collect(tabId, NEGOTIATIONS);
  }
  catch (error) {
    return { ok: false, count: 0, reason: error instanceof Error ? error.message : String(error) };
  }

  if (items.length === 0)
    return { ok: true, count: 0, reason: 'откликов на странице не найдено' };

  const pushed = await push(base, key, items);
  if (pushed === false)
    return { ok: false, count: items.length, reason: 'админка не приняла переговоры' };

  return { ok: true, count: items.length, reason: '' };
}

async function workerTabId(): Promise<number> {
  const tab = await requireWorkerTab().catch(async () => {
    if ((await getFlags()).autoQueue !== true)
      throw new Error('выключено');

    await adoptHhWorker(NEGOTIATIONS);

    return requireWorkerTab();
  });

  return requireTabId(tab);
}

async function collect(tabId: number, url: string): Promise<NegotiationItem[]> {
  const loaded = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url, active: false });
  await loaded;

  const tab = await browser.tabs.get(tabId);
  if ((tab.url || '').startsWith(LOGIN_URL))
    throw new Error('hh.ru просит войти (login)');

  await delay(RENDER_WAIT_MS);
  const results = await browser.scripting.executeScript({ target: { tabId }, func: extractNegotiations });

  return asItems(results[0]?.result);
}

async function push(base: string, key: string, items: NegotiationItem[]): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/negotiations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ items }),
    });

    return res.ok;
  }
  catch {
    return false;
  }
}

function asItems(raw: unknown): NegotiationItem[] {
  if (Array.isArray(raw) === false)
    return [];

  return raw.filter(isItem);
}

function isItem(value: unknown): value is NegotiationItem {
  if (typeof value !== 'object' || value === null)
    return false;

  const row = value as Record<string, unknown>;
  const stateOk = row.state === 'invitation' || row.state === 'discard' || row.state === 'response';

  return typeof row.vacancyId === 'string'
    && stateOk
    && typeof row.employer === 'string'
    && typeof row.title === 'string'
    && typeof row.url === 'string'
    && typeof row.updatedAt === 'number';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Выполняется в контексте страницы hh.ru через scripting.executeScript.
 * Всё нужное объявлено внутри: снаружи функция сериализуется и ничего не видит.
 */
function extractNegotiations(): unknown[] {
  type Row = { vacancyId: string; state: string; employer: string; title: string; url: string; updatedAt: number };
  type Rec = Record<string, unknown>;

  const out = new Map<string, Row>();

  const asRec = (value: unknown): Rec | null =>
    typeof value === 'object' && value !== null ? value as Rec : null;

  const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

  const stateOf = (raw: string): string => {
    const value = raw.toLowerCase();
    if (/invit|приглаш/.test(value))
      return 'invitation';

    if (/discard|reject|decline|отказ/.test(value))
      return 'discard';

    return 'response';
  };

  const stampOf = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value))
      return value < 1e12 ? value * 1000 : value;

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed) === false)
        return parsed;
    }

    return 0;
  };

  const add = (row: Row): void => {
    if (/^\d+$/.test(row.vacancyId) === false || out.has(row.vacancyId))
      return;

    out.set(row.vacancyId, row);
  };

  const rawState = (value: unknown): string => {
    if (typeof value === 'string')
      return value;

    const rec = asRec(value);
    if (rec === null)
      return '';

    return text(rec.id) || text(rec.name) || text(rec.code);
  };

  const rowFromRecord = (rec: Rec): Row | null => {
    const vacancy = asRec(rec.vacancy);
    const vacancyId = text(vacancy?.id !== undefined ? String(vacancy.id) : '') || text(rec.vacancyId !== undefined ? String(rec.vacancyId) : '');
    if (/^\d+$/.test(vacancyId) === false)
      return null;

    const state = rawState(rec.substate) || rawState(rec.state) || rawState(rec.lastState);
    if (state.length === 0)
      return null;

    const employer = asRec(vacancy?.employer) || asRec(vacancy?.company) || asRec(rec.employer);
    const stamp = [rec.updatedAt, rec.lastChangeTime, rec.updated_at, rec.createdAt, rec.created_at, rec.date]
      .map(stampOf)
      .find(value => value > 0);

    return {
      vacancyId,
      state: stateOf(state),
      employer: text(employer?.name) || text(rec.employerName) || text(rec.company),
      title: text(vacancy?.name) || text(vacancy?.title) || text(rec.vacancyName) || text(rec.name),
      url: text(vacancy?.alternateUrl) || `https://hh.ru/vacancy/${vacancyId}`,
      updatedAt: stamp ?? Date.now(),
    };
  };

  const fromInitialState = (): void => {
    const node = document.querySelector('template#HH-Lux-InitialState');
    const json = node?.textContent || '';
    if (json.trim().length === 0)
      return;

    const state: unknown = JSON.parse(json);
    const walk = (value: unknown, depth: number): void => {
      if (depth > 14 || out.size > 400)
        return;

      if (Array.isArray(value)) {
        for (const item of value)
          walk(item, depth + 1);

        return;
      }

      const rec = asRec(value);
      if (rec === null)
        return;

      const row = rowFromRecord(rec);
      if (row)
        add(row);

      for (const nested of Object.values(rec))
        walk(nested, depth + 1);
    };
    walk(state, 0);
  };

  const fromDom = (): void => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-qa^="negotiations-item"]'));
    for (const card of cards) {
      const link = card.querySelector<HTMLAnchorElement>('a[href*="/vacancy/"]');
      const vacancyId = link?.href.match(/\/vacancy\/(\d+)/)?.[1] || '';
      if (link === null || vacancyId.length === 0)
        continue;

      const body = (card.innerText || card.textContent || '').replace(/\s+/g, ' ');
      const employerNode = card.querySelector<HTMLElement>('a[href*="/employer/"], [data-qa*="employer"], [data-qa*="company"]');

      add({
        vacancyId,
        state: /приглашение/i.test(body) ? 'invitation' : /отказ/i.test(body) ? 'discard' : 'response',
        employer: text(employerNode?.textContent),
        title: text(link.textContent),
        url: link.href.split('?')[0],
        updatedAt: Date.now(),
      });
    }
  };

  try {
    fromInitialState();
  }
  catch {
  }

  if (out.size === 0) {
    try {
      fromDom();
    }
    catch {
    }
  }

  return Array.from(out.values());
}

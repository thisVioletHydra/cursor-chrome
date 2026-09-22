import type { ApplyPayload } from './bridge';

import { isJunkApply } from '../chrome/apply-log';
import { ancestors, ask, localDay } from './bridge';

const MONTH = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
const DATE_IN_TEXT = new RegExp(`(сегодня|вчера|\\d{1,2}\\s+(?:${MONTH}))`, 'i');
const CHAT = /перейти в чат/i;
const APPLY = /откликнуться/i;
const NEGOTIATIONS = 'https://hh.ru/applicant/negotiations';

let lastPull = 0;

export function scanNegotiations(): void {
  if (/\/applicant\/negotiations/i.test(location.pathname) === false)
    return;

  void ingest(document);
}

export async function pullRemoteNegotiations(): Promise<{ ok: true; count: number }> {
  if (Date.now() - lastPull < 12_000)
    return { ok: true, count: 0 };

  lastPull = Date.now();
  if (/\/applicant\/negotiations/i.test(location.pathname))
    return { ok: true, count: await ingest(document) };

  try {
    const res = await fetch(NEGOTIATIONS, {
      credentials: 'same-origin',
      headers: { accept: 'text/html' },
    });
    if (res.ok === false)
      return { ok: true, count: 0 };

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fromDom = await ingest(doc);
    if (fromDom > 0)
      return { ok: true, count: fromDom };

    return { ok: true, count: await ingestJson(html) };
  }
  catch {
    return { ok: true, count: 0 };
  }
}

async function ingest(root: ParentNode): Promise<number> {
  const rows = negotiationRows(root);
  let count = 0;
  for (const row of rows) {
    if (cardDate(row) !== 'сегодня')
      continue;

    const payload = payloadFrom(row);
    if (payload.vacancyId.length === 0)
      continue;

    count += 1;
    await ask({ type: 'apply-log', ...payload });
  }

  return count;
}

async function ingestJson(html: string): Promise<number> {
  const found = new Map<string, ApplyPayload>();
  for (const blob of jsonBlobs(html))
    collectFromUnknown(blob, found);

  for (const payload of found.values())
    await ask({ type: 'apply-log', ...payload });

  return found.size;
}

function jsonBlobs(html: string): unknown[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blobs: unknown[] = [];
  for (const script of doc.querySelectorAll('script')) {
    const text = (script.textContent || '').trim();
    if (text.includes('vacancy') === false)
      continue;

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
      continue;

    try {
      blobs.push(JSON.parse(text.slice(start, end + 1)));
    }
    catch {
    }
  }

  return blobs;
}

function collectFromUnknown(value: unknown, out: Map<string, ApplyPayload>, depth = 0): void {
  if (depth > 8 || out.size > 80)
    return;

  if (Array.isArray(value)) {
    for (const item of value)
      collectFromUnknown(item, out, depth + 1);

    return;
  }

  if (value === null || typeof value !== 'object')
    return;

  const rec = value as Record<string, unknown>;
  const payload = payloadFromRecord(rec);
  if (payload && isTodayRecord(rec))
    out.set(payload.vacancyId, payload);

  for (const nested of Object.values(rec))
    collectFromUnknown(nested, out, depth + 1);
}

function payloadFromRecord(rec: Record<string, unknown>): ApplyPayload | null {
  const vacancy = rec.vacancy !== null && typeof rec.vacancy === 'object'
    ? rec.vacancy as Record<string, unknown>
    : rec;
  const id = String(rec.vacancyId || rec.vacancy_id || vacancy.id || '');
  if (/^\d+$/.test(id) === false)
    return null;

  const employer = vacancy.employer !== null && typeof vacancy.employer === 'object'
    ? vacancy.employer as Record<string, unknown>
    : rec;
  const title = String(vacancy.name || rec.name || rec.title || '');
  const company = String(employer.name || rec.company || rec.employerName || '');

  return { title, company, url: `https://hh.ru/vacancy/${id}`, vacancyId: id };
}

function isTodayRecord(rec: Record<string, unknown>): boolean {
  const stamps = [rec.createdAt, rec.created_at, rec.updatedAt, rec.updated_at, rec.date, rec.lastChangeTime];
  const today = localDay(Date.now());

  return stamps.some((stamp) => {
    if (typeof stamp === 'number') {
      const ms = stamp < 1e12 ? stamp * 1000 : stamp;

      return localDay(ms) === today;
    }

    if (typeof stamp !== 'string' || stamp.length === 0)
      return false;

    if (/сегодня/i.test(stamp))
      return true;

    const parsed = Date.parse(stamp);

    return Number.isNaN(parsed) === false && localDay(parsed) === today;
  });
}

function negotiationRows(root: ParentNode): HTMLElement[] {
  const known = Array.from(root.querySelectorAll<HTMLElement>('[data-qa="negotiations-item"]'));
  if (known.length > 0)
    return known.filter(isNegotiationRow);

  const buttons = Array.from(root.querySelectorAll('button, a')).filter((element) => {
    return CHAT.test((element.textContent || '').replace(/\s+/g, ' ').trim());
  });
  const cards: HTMLElement[] = [];
  for (const btn of buttons) {
    if ((btn instanceof HTMLElement) === false)
      continue;

    const card = closestVacancyCard(btn);
    if (card === null || cards.includes(card) || isNegotiationRow(card) === false)
      continue;

    cards.push(card);
  }

  return cards;
}

function isNegotiationRow(card: HTMLElement): boolean {
  const text = card.textContent || '';
  if (CHAT.test(text) === false)
    return false;

  return APPLY.test(text) === false;
}

function closestVacancyCard(start: HTMLElement): HTMLElement | null {
  let card: HTMLElement | null = null;
  for (const node of ancestors(start, 14)) {
    const links = vacancyLinks(node);
    if (links.length > 1)
      break;

    if (links.length === 1)
      card = node;
  }

  return card;
}

function payloadFrom(card: HTMLElement): ApplyPayload {
  const link = vacancyLinks(card)[0];
  if (link === undefined)
    return { title: '', company: '', url: '', vacancyId: '' };

  const vacancyId = link.href.match(/\/vacancy\/(\d+)/)?.[1] || '';
  const title = (link.textContent || '').trim();
  const company = Array.from(card.querySelectorAll('a'))
    .map(item => (item.textContent || '').trim())
    .find(text => text.length > 1 && text !== title && isJunkApply({ title: 'ok', company: text }) === false)
    || '';
  if ((title.length > 0 && isJunkApply({ title, company: '' }))
    || (company.length > 0 && isJunkApply({ title: 'ok', company })))
    return { title: '', company: '', url: '', vacancyId: '' };

  return { title, company, url: link.href.split('?')[0], vacancyId };
}

function vacancyLinks(root: HTMLElement): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/vacancy/"]'))
    .filter((item) => {
      const id = item.href.match(/\/vacancy\/(\d+)/)?.[1];
      const title = (item.textContent || '').trim();
      if (!id || title.length <= 5)
        return false;

      return isJunkApply({ title, company: '' }) === false;
    });
}

function cardDate(card: HTMLElement): string {
  const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ');
  const cut = text.replace(/был онлайн[\s\S]*/i, '');
  const match = cut.match(DATE_IN_TEXT);

  return match ? match[1].toLowerCase() : '';
}

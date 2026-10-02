import { SEND_PER_DAY } from '../limits.ts';
import { parseJsonLoose } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sqlite from 'node:sqlite';
import timers from 'node:timers/promises';

const SWAY = 0.16;
const DAY_LOW = Math.floor(SEND_PER_DAY * (1 - SWAY));
const DAY_HIGH = Math.ceil(SEND_PER_DAY * (1 + SWAY));
const INSERT_STEP = 5_000;
const PASSED_LIMIT = 80;

const LEGACY_HIDE = 'не подходит профессия';
const RELOOK_REASON = 'пересмотр';
const RELOOK_STALE_MS = 20 * 60 * 1000;

export const HIDE_REASON = 'скрыл, уже видели';

const QUIET_REASON = new Set(['', 'уже видели', 'уже в очереди']);

export type PassedNote = {
  id: string;
  reason: string;
  company?: string;
  title?: string;
  at?: number;
};

export type PassedRow = {
  id: string;
  at: number;
  reason: string;
  company: string;
  title: string;
};

export type DayRoll = { cap: number; sent: number };

export function storePath(): string {
  return path.join(dataDir(), 'hh.sqlite');
}

export async function openStore(): Promise<void> {
  if (database === null) {
    await fsPromises.mkdir(dataDir(), { recursive: true });
    const opened = new sqlite.DatabaseSync(storePath(), { timeout: 5_000 });
    opened.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS seen (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS day_cap (
        day TEXT PRIMARY KEY,
        cap INTEGER NOT NULL,
        sent INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        added INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS search_page (
        query TEXT PRIMARY KEY,
        page INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hidden (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL
      ) STRICT;
    `);
    ensureLinkTitle(opened);
    ensurePassed(opened);
    database = opened;
  }

  if (migrated)
    return;

  await migrateSeenFile();
  migrated = true;
}

export function readDay(day: string): DayRoll | null {
  return rollOf(openDatabase().prepare('SELECT cap, sent FROM day_cap WHERE day = ?').get(day));
}

export function writeDay(day: string, cap: number, sent: number): void {
  openDatabase().prepare('INSERT INTO day_cap (day, cap, sent) VALUES (?, ?, ?)').run(day, cap, sent);
}

export function bumpDay(day: string): void {
  openDatabase().prepare('UPDATE day_cap SET sent = sent + 1 WHERE day = ?').run(day);
}

const STAYS_WAITING = new Set([
  'вопросы работодателя',
  'вопросы работодателя, обязательные поля',
  'свои вопросы HH',
  'ждёт тебя',
  'уже видели',
]);

export function lookupShelved(ids: readonly string[]): string[] {
  const nums = uniqueNums(ids);
  if (nums.length === 0)
    return [];

  const marks = nums.map(() => '?').join(', ');
  const opened = openDatabase();
  const found = new Set<string>();
  for (const row of opened.prepare(`SELECT id FROM hidden WHERE id IN (${marks})`).all(...nums)) {
    const id = textId(row.id);
    if (id !== null)
      found.add(id);
  }

  for (const row of opened.prepare(`SELECT id, reason FROM passed WHERE id IN (${marks})`).all(...nums)) {
    const id = textId(row.id);
    const reason = sqlText(row.reason);
    if (id !== null && reason.length > 0 && STAYS_WAITING.has(reason) === false)
      found.add(id);
  }

  return ids.filter(id => found.has(id));
}

export function lookupSeen(ids: readonly string[]): string[] {
  const nums = uniqueNums(ids);
  if (nums.length === 0)
    return [];

  const marks = nums.map(() => '?').join(', ');
  const found = new Set<string>();
  for (const row of openDatabase().prepare(`SELECT id FROM seen WHERE id IN (${marks})`).all(...nums)) {
    const id = textId(row.id);
    if (id !== null)
      found.add(id);
  }

  return ids.filter(id => found.has(id));
}

export function countSeen(): number {
  return countTable('seen');
}

export function countHidden(): number {
  return countTable('hidden');
}

export function countPassed(): number {
  const row = openDatabase().prepare(`SELECT COUNT(*) AS total FROM passed WHERE reason != '' AND reason != 'уже видели' AND reason != 'пересмотр'`).get();
  if (row === undefined)
    return 0;

  return numberOf(row.total);
}

export function insertSeen(ids: readonly string[], at: number): Promise<void> {
  return insertNums(uniqueNums(ids), at, 'seen');
}

export function insertHidden(ids: readonly string[], at: number): Promise<void> {
  return insertNums(uniqueNums(ids), at, 'hidden');
}

export function savePassed(rows: readonly PassedNote[]): void {
  if (rows.length === 0)
    return;

  const opened = openDatabase();
  const select = opened.prepare('SELECT reason, company, title FROM passed WHERE id = ?');
  const insert = opened.prepare('INSERT INTO passed (id, at, reason, company, title) VALUES (?, ?, ?, ?, ?)');
  const fill = opened.prepare('UPDATE passed SET company = ?, title = ? WHERE id = ?');
  const replace = opened.prepare('UPDATE passed SET at = ?, reason = ?, company = ?, title = ? WHERE id = ?');
  opened.exec('BEGIN');
  try {
    for (const row of rows)
      writePassed(select, insert, fill, replace, row);

    opened.exec('COMMIT');
  }
  catch (error) {
    opened.exec('ROLLBACK');

    throw error;
  }
}

export function listPassed(limit = PASSED_LIMIT): PassedRow[] {
  const cap = Math.min(PASSED_LIMIT, Math.max(1, Math.floor(limit)));
  const rows = openDatabase().prepare(`
    SELECT id, at, reason, company, title
    FROM passed
    WHERE reason != '' AND reason != 'уже видели' AND reason != 'пересмотр'
    ORDER BY at DESC
    LIMIT ?
  `).all(cap);
  const out: PassedRow[] = [];
  for (const row of rows) {
    const id = textId(row.id);
    const at = wholeAt(row.at);
    const reason = sqlText(row.reason);
    if (id === null || at === null || reason.length === 0 || reason === 'уже видели' || reason === RELOOK_REASON)
      continue;

    out.push({
      id,
      at,
      reason,
      company: sqlText(row.company),
      title: sqlText(row.title),
    });
  }

  return out;
}

export function readSearchPages(queries: readonly string[]): Record<string, number> {
  const select = openDatabase().prepare('SELECT page FROM search_page WHERE query = ?');
  const pages: Record<string, number> = {};
  for (const query of queries) {
    if (query.length === 0)
      continue;

    pages[query] = pageValue(select.get(query));
  }

  return pages;
}

export function writeSearchPage(query: string, page: number): void {
  const text = query.trim();
  const next = clampPage(page);
  if (text.length === 0 || next === null)
    return;

  openDatabase().prepare(`
    INSERT INTO search_page (query, page) VALUES (?, ?)
    ON CONFLICT(query) DO UPDATE SET page = excluded.page
  `).run(text, next);
}

export function clearSearchPages(queries: readonly string[]): void {
  const drop = openDatabase().prepare('DELETE FROM search_page WHERE query = ?');
  for (const query of queries) {
    const text = query.trim();
    if (text.length === 0)
      continue;

    drop.run(text);
  }
}

function capOf(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isInteger(value) === false)
    return null;

  if (value < DAY_LOW || value > DAY_HIGH)
    return null;

  return value;
}

let database: sqlite.DatabaseSync | null = null;
let migrated = false;

function ensurePassed(opened: sqlite.DatabaseSync): void {
  opened.exec(`
    CREATE TABLE IF NOT EXISTS passed (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT ''
    ) STRICT;
  `);
  opened.prepare(`
    INSERT OR IGNORE INTO passed (id, at, reason, company, title)
    SELECT id, at, ?, '', '' FROM hidden
  `).run(HIDE_REASON);
  opened.prepare('UPDATE passed SET reason = ? WHERE reason = ?').run(HIDE_REASON, LEGACY_HIDE);
}

export function claimRelook(busyIds: readonly string[], limit: number, now = Date.now()): PassedRow[] {
  const cap = Math.min(8, Math.max(0, Math.floor(limit)));
  if (cap === 0)
    return [];

  const opened = openDatabase();
  const busy = uniqueNums(busyIds);
  if (busy.length > 0) {
    const marks = busy.map(() => '?').join(', ');
    opened.prepare(`DELETE FROM passed WHERE reason IN (?, ?, ?) AND id IN (${marks})`).run(HIDE_REASON, LEGACY_HIDE, RELOOK_REASON, ...busy);
  }

  const picked = opened.prepare(`
    SELECT id, at, reason, company, title
    FROM passed
    WHERE reason = ? OR (reason = ? AND at < ?)
    ORDER BY at ASC
    LIMIT ?
  `).all(HIDE_REASON, RELOOK_REASON, now - RELOOK_STALE_MS, cap);
  const rows: PassedRow[] = [];
  for (const row of picked) {
    const id = textId(row.id);
    const at = wholeAt(row.at);
    if (id === null || at === null)
      continue;

    rows.push({ id, at, reason: sqlText(row.reason), company: sqlText(row.company), title: sqlText(row.title) });
  }

  if (rows.length === 0)
    return [];

  const dropSeen = opened.prepare('DELETE FROM seen WHERE id = ?');
  const dropHidden = opened.prepare('DELETE FROM hidden WHERE id = ?');
  const claim = opened.prepare('UPDATE passed SET reason = ?, at = ? WHERE id = ?');
  opened.exec('BEGIN');
  try {
    for (const row of rows) {
      const id = numId(row.id);
      if (id === null)
        continue;

      dropSeen.run(id);
      dropHidden.run(id);
      claim.run(RELOOK_REASON, now, id);
    }

    opened.exec('COMMIT');
  }
  catch (error) {
    opened.exec('ROLLBACK');

    throw error;
  }

  return rows;
}

export function forgetPassed(ids: readonly string[]): void {
  const nums = uniqueNums(ids);
  if (nums.length === 0)
    return;

  const marks = nums.map(() => '?').join(', ');
  openDatabase().prepare(`DELETE FROM passed WHERE id IN (${marks})`).run(...nums);
}

function shownHideReason(reason: string): string {
  return reason === LEGACY_HIDE ? HIDE_REASON : reason;
}

function cannedHide(reason: string): boolean {
  return reason === HIDE_REASON || reason === LEGACY_HIDE || reason === RELOOK_REASON;
}

function writePassed(
  select: sqlite.StatementSync,
  insert: sqlite.StatementSync,
  fill: sqlite.StatementSync,
  replace: sqlite.StatementSync,
  row: PassedNote,
): void {
  const id = numId(row.id);
  const reason = shownHideReason(row.reason.trim().slice(0, 200));
  if (id === null || QUIET_REASON.has(reason))
    return;

  const company = cleanCompany(row.company ?? '');
  const title = clipText(row.title ?? '');
  const at = row.at ?? Date.now();
  const existing = select.get(id);
  if (existing === undefined) {
    insert.run(id, at, reason, company, title);

    return;
  }

  const prior = sqlText(existing.reason);
  const keptCompany = sqlText(existing.company);
  const keptTitle = sqlText(existing.title);
  const nextCompany = keptCompany.length > 0 ? keptCompany : company;
  const nextTitle = keptTitle.length > 0 ? keptTitle : title;
  if (cannedHide(prior) && reason !== prior) {
    replace.run(at, reason, nextCompany, nextTitle, id);

    return;
  }

  if (nextCompany !== keptCompany || nextTitle !== keptTitle)
    fill.run(nextCompany, nextTitle, id);
}

function ensureLinkTitle(opened: sqlite.DatabaseSync): void {
  const names = opened.prepare('PRAGMA table_info(links)').all().flatMap(row => typeof row.name === 'string' ? [row.name] : []);
  if (names.includes('title'))
    return;

  opened.exec(`ALTER TABLE links ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
}

function pageValue(row: Record<string, sqlite.SQLOutputValue> | undefined): number {
  if (row === undefined)
    return 0;

  const page = clampPage(row.page);

  return page === null ? 0 : page;
}

function clampPage(value: unknown): number | null {
  const page = typeof value === 'bigint' ? Number(value) : value;
  if (typeof page !== 'number' || Number.isInteger(page) === false)
    return null;

  if (page < 0)
    return null;

  return page;
}

function dataDir(): string {
  if (process.env.HH_STORE)
    return path.dirname(process.env.HH_STORE);

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data';

  return path.join(process.cwd(), 'data');
}

function seenFile(): string {
  return path.join(dataDir(), 'seen.json');
}

export function hhDatabase(): sqlite.DatabaseSync {
  return openDatabase();
}

function openDatabase(): sqlite.DatabaseSync {
  if (database === null)
    throw new Error('база не открыта');

  return database;
}

function rollOf(row: Record<string, sqlite.SQLOutputValue> | undefined): DayRoll | null {
  if (row === undefined)
    return null;

  const cap = capOf(row.cap);
  const sent = wholeOf(row.sent);
  if (cap === null || sent === null)
    return null;

  return { cap, sent };
}

function wholeOf(value: sqlite.SQLOutputValue): number | null {
  if (typeof value !== 'number' || Number.isInteger(value) === false)
    return null;

  if (value < 0)
    return null;

  return value;
}

function numberOf(value: sqlite.SQLOutputValue): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return value;

  if (typeof value === 'bigint')
    return Number(value);

  return 0;
}

function countTable(table: 'seen' | 'hidden'): number {
  const row = openDatabase().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get();
  if (row === undefined)
    return 0;

  return numberOf(row.total);
}

async function insertNums(nums: number[], at: number, table: 'seen' | 'hidden'): Promise<void> {
  if (nums.length === 0)
    return;

  const opened = openDatabase();
  const insert = opened.prepare(`INSERT OR IGNORE INTO ${table} (id, at) VALUES (?, ?)`);
  for (let offset = 0; offset < nums.length; offset += INSERT_STEP) {
    const chunk = nums.slice(offset, offset + INSERT_STEP);
    opened.exec('BEGIN');
    try {
      for (const id of chunk)
        insert.run(id, at);

      opened.exec('COMMIT');
    }
    catch (error) {
      opened.exec('ROLLBACK');

      throw error;
    }

    if (offset + INSERT_STEP < nums.length)
      await timers.setImmediate();
  }
}

async function migrateSeenFile(): Promise<void> {
  let text: string;
  try {
    text = await fsPromises.readFile(seenFile(), 'utf8');
  }
  catch {
    return;
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null)
    return;

  const value = parsed.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return;

  const seen = 'seen' in value ? value.seen : undefined;
  const ids = Array.isArray(seen) ? seen.flatMap(stringId) : [];
  await insertSeen(ids, Date.now());
  keepRoll(
    'day' in value ? value.day : undefined,
    'cap' in value ? value.cap : undefined,
    'sent' in value ? value.sent : undefined,
  );
  if (parsed.salvaged === false)
    await fsPromises.unlink(seenFile());
}

function keepRoll(day: unknown, cap: unknown, sent: unknown): void {
  if (typeof day !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(day) === false)
    return;

  const kept = capOf(cap);
  if (kept === null)
    return;

  const count = typeof sent === 'number' && Number.isInteger(sent) && sent >= 0 ? sent : 0;
  openDatabase().prepare('INSERT OR IGNORE INTO day_cap (day, cap, sent) VALUES (?, ?, ?)').run(day, kept, count);
}

function stringId(value: unknown): string[] {
  if (typeof value !== 'string')
    return [];

  return [value];
}

function uniqueNums(ids: readonly string[]): number[] {
  const out: number[] = [];
  const taken = new Set<number>();
  for (const id of ids) {
    const value = numId(id);
    if (value === null || taken.has(value))
      continue;

    taken.add(value);
    out.push(value);
  }

  return out;
}

function numId(id: string): number | null {
  if (/^\d+$/.test(id) === false)
    return null;

  const value = Number(id);
  if (Number.isSafeInteger(value) === false || value <= 0)
    return null;

  return value;
}

function wholeAt(value: sqlite.SQLOutputValue): number | null {
  const at = typeof value === 'bigint' ? Number(value) : value;
  if (typeof at !== 'number' || Number.isInteger(at) === false || at < 0)
    return null;

  return at;
}

function sqlText(value: sqlite.SQLOutputValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function clipText(value: string): string {
  return value.trim().slice(0, 200);
}

function cleanCompany(value: string): string {
  const text = clipText(value);
  if (text === 'без компании')
    return '';

  return text;
}

function textId(value: sqlite.SQLOutputValue): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return String(value);

  if (typeof value === 'bigint' && value > 0n)
    return value.toString();

  return null;
}

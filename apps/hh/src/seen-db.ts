import { SEND_PER_DAY } from './limits.ts';
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
        added INTEGER NOT NULL
      ) STRICT;
    `);
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
  const row = openDatabase().prepare('SELECT COUNT(*) AS total FROM seen').get();
  if (row === undefined)
    return 0;

  return numberOf(row.total);
}

export function insertSeen(ids: readonly string[], at: number): Promise<void> {
  return insertNums(uniqueNums(ids), at);
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

async function insertNums(nums: number[], at: number): Promise<void> {
  if (nums.length === 0)
    return;

  const opened = openDatabase();
  const insert = opened.prepare('INSERT OR IGNORE INTO seen (id, at) VALUES (?, ?)');
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

function textId(value: sqlite.SQLOutputValue): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return String(value);

  if (typeof value === 'bigint' && value > 0n)
    return value.toString();

  return null;
}

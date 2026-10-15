// Stage D: extension settings kept in the admin. Own SQLite file <root>/ext-settings.sqlite, one new table;
// nothing existing is migrated. Only the MANAGED booleans: never LLM keys, never personal data.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sqlite from 'node:sqlite';

export const MANAGED = ['hideJunk', 'keepSession', 'showPop', 'showMachine'] as const;
export type Managed = (typeof MANAGED)[number];
export type ExtSettings = Partial<Record<Managed, boolean>>;

export function extSettingsPath(): string {
  const root = process.env.WEB_SECRETS ? path.dirname(process.env.WEB_SECRETS) : process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(process.cwd(), 'data');
  return path.join(root, 'ext-settings.sqlite');
}

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export function cleanSettings(raw: unknown): ExtSettings {
  const out: ExtSettings = {};
  if (raw === null || typeof raw !== 'object')
    return out;
  for (const key of MANAGED) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean')
      out[key] = v;
  }
  return out;
}

export function createExtSettings(file = extSettingsPath()) {
  let db: sqlite.DatabaseSync | null = null;
  const open = (): sqlite.DatabaseSync => {
    if (db === null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      db = new sqlite.DatabaseSync(file);
      db.exec('CREATE TABLE IF NOT EXISTS ext_setting (login TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL) STRICT');
    }
    return db;
  };
  const check = (login: string) => {
    if (LOGIN.test(login) === false)
      throw new Error('кривой login');
  };
  // null = nothing in the admin yet → the extension keeps its local values
  const get = (login: string): ExtSettings | null => {
    if (LOGIN.test(login) === false || (db === null && fs.existsSync(file) === false))
      return null;
    const row = open().prepare('SELECT json FROM ext_setting WHERE login = ?').get(login) as { json?: string } | undefined;
    if (row?.json === undefined)
      return null;
    try {
      const s = cleanSettings(JSON.parse(row.json));
      return Object.keys(s).length > 0 ? s : null;
    }
    catch {
      return null;
    }
  };
  const set = (login: string, patch: unknown, now = Date.now()): ExtSettings => {
    check(login);
    const next = { ...(get(login) ?? {}), ...cleanSettings(patch) };
    open().prepare('INSERT INTO ext_setting (login, json, at) VALUES (?, ?, ?) ON CONFLICT(login) DO UPDATE SET json = excluded.json, at = excluded.at').run(login, JSON.stringify(next), now);
    return next;
  };
  // one-time handover from the extension: only when the admin has nothing for this login
  const seed = (login: string, values: unknown, now = Date.now()): boolean => {
    check(login);
    const clean = cleanSettings(values);
    if (Object.keys(clean).length === 0 || get(login) !== null)
      return false;
    const r = open().prepare('INSERT INTO ext_setting (login, json, at) VALUES (?, ?, ?) ON CONFLICT(login) DO NOTHING').run(login, JSON.stringify(clean), now);
    return Number(r.changes) > 0;
  };
  const close = () => {
    db?.close();
    db = null;
  };
  return { get, set, seed, close };
}
export type ExtSettingsStore = ReturnType<typeof createExtSettings>;
export const extSettings = createExtSettings();

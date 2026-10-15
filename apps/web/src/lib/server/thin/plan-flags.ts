// Per-account switch «server planner» (stage C). Own small SQLite file <root>/plan-flags.sqlite with one new
// table; no existing DB/table is touched or migrated. Missing row = off → the old extension logic keeps running.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sqlite from 'node:sqlite';

export function planFlagsPath(): string {
  const root = process.env.WEB_SECRETS ? path.dirname(process.env.WEB_SECRETS) : process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(process.cwd(), 'data');

  return path.join(root, 'plan-flags.sqlite');
}

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export function createPlanFlags(file = planFlagsPath()) {
  let db: sqlite.DatabaseSync | null = null;
  const open = (): sqlite.DatabaseSync => {
    if (db === null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      db = new sqlite.DatabaseSync(file);
      db.exec('CREATE TABLE IF NOT EXISTS plan_flag (login TEXT PRIMARY KEY, enabled INTEGER NOT NULL, at INTEGER NOT NULL) STRICT');
    }
    return db;
  };
  // reads never create the file: an unknown login on a fresh server is simply «off»
  const enabled = (login: string): boolean => {
    if (LOGIN.test(login) === false || (db === null && fs.existsSync(file) === false))
      return false;
    const row = open().prepare('SELECT enabled FROM plan_flag WHERE login = ?').get(login) as { enabled?: number } | undefined;
    return row?.enabled === 1;
  };
  const setEnabled = (login: string, on: boolean, now = Date.now()): void => {
    if (LOGIN.test(login) === false)
      throw new Error('кривой login');
    open().prepare('INSERT INTO plan_flag (login, enabled, at) VALUES (?, ?, ?) ON CONFLICT(login) DO UPDATE SET enabled = excluded.enabled, at = excluded.at').run(login, on ? 1 : 0, now);
  };
  const close = () => {
    db?.close();
    db = null;
  };

  return { enabled, setEnabled, close };
}
export type PlanFlags = ReturnType<typeof createPlanFlags>;

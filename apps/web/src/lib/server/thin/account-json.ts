// Additive replacement of the unfinished thin SQLite stores. Legacy files are opened read-only;
// all new writes go to JSON on the existing volume, never to a new database.
import process from 'node:process';

import fs from 'node:fs';
import path from 'node:path';
import sqlite from 'node:sqlite';
import { commandJournal } from './command-journal.ts';

export function accountJson(file: string, table: 'plan_flag' | 'ext_setting') {
  const target = file.endsWith('.sqlite') ? `${file}.json` : file;
  const legacy = file.endsWith('.sqlite')
    ? file
    : file.replace(/\.json$/, '.sqlite');
  const journal = commandJournal(target);
  let rows: Record<string, unknown> | undefined;
  function load() {
    if (rows) return rows;

    rows = (journal.load() as Record<string, unknown> | null) || {};
    if (fs.existsSync(legacy)) {
      const db = new sqlite.DatabaseSync(legacy, { readOnly: true });
      try {
        if (
          db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        ) {
          for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
            const login = String(row.login);
            if (!(login in rows))
              rows[login] =
                table === 'plan_flag'
                  ? { enabled: row.enabled === 1, scenarios: {} }
                  : JSON.parse(String(row.json));
          }
        }
      } finally {
        db.close();
      }
    }

    return rows;
  }
  return {
    get: (login: string) => {
      return load()[login];
    },
    set: (login: string, value: unknown) => {
      if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error('login');
      const next = { ...load(), [login]: value };
      journal.save(next);
      rows = next;
    },
    close: () => {
      rows = undefined;
    },
  };
}
export function volumeFile(name: string) {
  return path.join(
    process.env.WEB_SECRETS
      ? path.dirname(process.env.WEB_SECRETS)
      : process.env.RAILWAY_ENVIRONMENT
        ? '/data'
        : path.join(process.cwd(), 'data'),
    name,
  );
}

// Owner column for memory and rules in hh.sqlite. Idempotent, never deletes or rebuilds anything.
//   node local-debug/migrate-owner.mjs [--db <path>]            dry run: prints counts and checksums
//   node local-debug/migrate-owner.mjs --db <path> --apply      backup (VACUUM INTO) → verify backup → migrate → verify
// Default --db: local-debug/data/review/hh.sqlite. Owner: --owner (default thisVioletHydra).
import { migrateOwner, OWNER_TABLES } from '../apps/hh/src/review/owner.ts';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i > 0 ? process.argv[i + 1] : fallback;
};
const ALL_TABLES = [...OWNER_TABLES, 'review_draft', 'review_decision', 'waiter_form', 'vacancy_info', 'review_meta', 'match_cache', 'embed_cache'];

// rows + checksum per table, owner column excluded so it can be compared before/after the migration
export function snapshot(db) {
  const out = {};
  for (const table of ALL_TABLES) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) === undefined)
      continue;

    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).filter(n => n !== 'owner');
    const rows = db.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${table} ORDER BY rowid`).all();
    out[table] = { rows: rows.length, sha: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16) };
  }

  return out;
}

export function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function run({ db: file, apply = false, owner = 'thisVioletHydra', backupDir = path.join(root, 'local-debug/backups') }) {
  const source = new DatabaseSync(file, { readOnly: !apply });
  const before = snapshot(source);
  const report = { file, before, apply, backup: null, backupOk: null, migration: null, after: null, afterOk: null };
  if (!apply) {
    source.close();

    return report;
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `hh.sqlite.before-owner-${Date.now()}`);
  source.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  const check = new DatabaseSync(backup, { readOnly: true });
  report.backup = backup;
  report.backupOk = same(snapshot(check), before);
  check.close();
  if (!report.backupOk) {
    source.close();
    throw new Error('бэкап не совпал с базой — миграция не запущена');
  }

  report.migration = migrateOwner(source, owner);
  report.after = snapshot(source);
  report.afterOk = same(report.after, before);
  source.close();

  return report;
}

if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  const report = run({ db: arg('--db', path.join(root, 'local-debug/data/review/hh.sqlite')), apply: process.argv.includes('--apply'), owner: arg('--owner', 'thisVioletHydra'), backupDir: arg('--backupDir', path.join(root, 'local-debug/backups')) });
  console.log(JSON.stringify(report, null, 2));
}

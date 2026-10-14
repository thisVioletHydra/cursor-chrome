// Owner scoping for memory and rules (answer_memory, canon_answer, memory_unlink).
// Backward compatible: works on a DB without the `owner` column (before local-debug/migrate-owner.mjs):
//   no column → the legacy owner (thisVioletHydra) sees everything as before, anyone else sees nothing and cannot write.
//   column    → every read/update/delete is filtered by owner, inserts carry the owner.
// answer_memory keeps q_key as PRIMARY KEY (rows are never rebuilt or deleted), so only the legacy owner writes
// server memory; other users keep memory locally in the extension (chrome.storage / IndexedDB).
import type sqlite from 'node:sqlite';

import { ownerLogin, ownerName, tenantLogin } from '../diary/tenant.ts';

export const OWNER_TABLES = ['answer_memory', 'canon_answer', 'memory_unlink'] as const;
export type OwnerTable = typeof OWNER_TABLES[number];

const seen = new WeakMap<sqlite.DatabaseSync, Map<string, boolean>>();

// A tenant's own database (data/tenants/<login>/hh.sqlite) belongs to that tenant entirely.
export function isTenantDb(db: sqlite.DatabaseSync): boolean {
  const where = (db as unknown as { location?: () => string | null }).location?.() ?? '';

  return /[\\/]tenants[\\/][^\\/]+[\\/]/.test(where);
}

export function currentOwner(): string {
  return tenantLogin() || ownerName();
}

export function isLegacyOwner(login: string): boolean {
  return ownerLogin(login) || login === ownerName();
}

export function hasOwnerColumn(db: sqlite.DatabaseSync, table: OwnerTable): boolean {
  let map = seen.get(db);
  if (!map) {
    map = new Map();
    seen.set(db, map);
  }
  if (!map.has(table)) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    map.set(table, cols.some(col => col.name === 'owner'));
  }

  return map.get(table) === true;
}

// Forget the cached column check (after a migration in the same process).
export function resetOwnerCache(db: sqlite.DatabaseSync): void {
  seen.delete(db);
}

// SQL condition + args for reads/updates/deletes.
export function ownerWhere(db: sqlite.DatabaseSync, table: OwnerTable, owner = currentOwner()): { sql: string; args: string[] } {
  if (isTenantDb(db) && hasOwnerColumn(db, table) === false)
    return { sql: '1 = 1', args: [] };

  if (hasOwnerColumn(db, table))
    return isLegacyOwner(owner) ? { sql: "owner IN (?, '')", args: [owner] } : { sql: 'owner = ?', args: [owner] };

  return isLegacyOwner(owner) ? { sql: '1 = 1', args: [] } : { sql: '0 = 1', args: [] };
}

export function canWrite(db: sqlite.DatabaseSync, table: OwnerTable, owner = currentOwner()): boolean {
  if (isLegacyOwner(owner) || (isTenantDb(db) && hasOwnerColumn(db, table) === false))
    return true;

  // shared primary key on answer_memory: a non-legacy write could overwrite the owner's row
  return table !== 'answer_memory' && hasOwnerColumn(db, table);
}

// Extra INSERT column for the owner, empty when the column does not exist yet.
export function ownerInsert(db: sqlite.DatabaseSync, table: OwnerTable, owner = currentOwner()): { col: string; ph: string; args: string[] } {
  return hasOwnerColumn(db, table) ? { col: ', owner', ph: ', ?', args: [owner] } : { col: '', ph: '', args: [] };
}

export type OwnerMigration = { table: OwnerTable; added: boolean; assigned: number; rows: number };

// Idempotent: adds `owner TEXT NOT NULL DEFAULT ''` where missing and assigns unowned rows to `owner`.
// Never drops or rebuilds a table.
export function migrateOwner(db: sqlite.DatabaseSync, owner: string): OwnerMigration[] {
  const out: OwnerMigration[] = [];
  for (const table of OWNER_TABLES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
    if (!exists)
      continue;

    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const added = cols.some(col => col.name === 'owner') === false;
    if (added)
      db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`);
    const assigned = Number(db.prepare(`UPDATE ${table} SET owner = ? WHERE owner = ''`).run(owner).changes);
    const rows = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    out.push({ table, added, assigned, rows });
  }
  resetOwnerCache(db);

  return out;
}

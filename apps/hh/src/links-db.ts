import { hhDatabase } from './seen-db.ts';

export type HeldLink = { id: string; url: string };

export function lookupHeld(ids: readonly string[]): string[] {
  const nums = uniqueNums(ids);
  if (nums.length === 0)
    return [];

  const marks = nums.map(() => '?').join(', ');
  const found = new Set<string>();
  for (const row of hhDatabase().prepare(`SELECT id FROM links WHERE id IN (${marks})`).all(...nums)) {
    const id = textId(row.id);
    if (id !== null)
      found.add(id);
  }

  return ids.filter(id => found.has(id));
}

export function listLinks(limit: number): HeldLink[] {
  const cap = Math.min(40, Math.max(1, limit));
  const rows = hhDatabase().prepare('SELECT id, url FROM links ORDER BY added ASC LIMIT ?').all(cap);
  const out: HeldLink[] = [];
  for (const row of rows) {
    const id = textId(row.id);
    const url = typeof row.url === 'string' ? row.url : '';
    if (id === null || url.length === 0)
      continue;

    out.push({ id, url });
  }

  return out;
}

export function insertLinks(rows: readonly HeldLink[], at: number): string[] {
  const fresh = rows.filter(row => vacancyUrl(row.id, row.url));
  if (fresh.length === 0)
    return [];

  const opened = hhDatabase();
  const inSeen = opened.prepare('SELECT 1 AS hit FROM seen WHERE id = ?');
  const inLinks = opened.prepare('SELECT 1 AS hit FROM links WHERE id = ?');
  const insert = opened.prepare('INSERT OR IGNORE INTO links (id, url, added) VALUES (?, ?, ?)');
  const saved: string[] = [];
  opened.exec('BEGIN');
  try {
    for (const row of fresh) {
      const id = numId(row.id);
      if (id === null)
        continue;

      if (inSeen.get(id) !== undefined || inLinks.get(id) !== undefined)
        continue;

      insert.run(id, row.url, at);
      saved.push(row.id);
    }

    opened.exec('COMMIT');
  }
  catch (error) {
    opened.exec('ROLLBACK');

    throw error;
  }

  return saved;
}

export function deleteLinks(ids: readonly string[]): void {
  const nums = uniqueNums(ids);
  if (nums.length === 0)
    return;

  const marks = nums.map(() => '?').join(', ');
  hhDatabase().prepare(`DELETE FROM links WHERE id IN (${marks})`).run(...nums);
}

function vacancyUrl(id: string, url: string): boolean {
  return url === `https://hh.ru/vacancy/${id}`;
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

function textId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return String(value);

  if (typeof value === 'bigint' && value > 0n)
    return value.toString();

  return null;
}

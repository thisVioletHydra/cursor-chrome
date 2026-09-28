import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(new URL('./session.sqlite', import.meta.url).pathname);

const tables = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table'`).all();
console.log('TABLES', JSON.stringify(tables, null, 2));

for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
  console.log('---', t.name, 'rows', rows.length);
  for (const row of rows) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'json' && typeof v === 'string') {
        try {
          out.json = redact(JSON.parse(v));
        }
        catch {
          out.json = `PARSE_FAIL len=${v.length}`;
        }
      }
      else if (typeof v === 'string' && /key|token|secret/i.test(k)) {
        out[k] = summarize(v);
      }
      else {
        out[k] = v;
      }
    }
    console.log(JSON.stringify(out, null, 2));
  }
}

function summarize(s) {
  if (typeof s !== 'string')
    return { type: typeof s };
  return {
    len: s.length,
    tail: s.length >= 2 ? s.slice(-2) : `(short:${s.length})`,
    empty: s.trim().length === 0,
  };
}

function redact(value, path = '') {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && /(key|token|secret|password)/i.test(path))
      return summarize(value);
    if (typeof value === 'string' && value.length > 24)
      return { len: value.length, tail: value.slice(-2), kind: 'long-string' };
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, i) => redact(item, `${path}[${i}]`));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const next = path ? `${path}.${k}` : k;
    if (k === 'key' || k === 'token' || /secret|password|apiKey/i.test(k))
      out[k] = typeof v === 'string' ? summarize(v) : redact(v, next);
    else
      out[k] = redact(v, next);
  }
  return out;
}

import type { CapturedForm } from './form.ts';
import type { VacancyInfo } from './vacancy.ts';
import type sqlite from 'node:sqlite';

import { asCapturedForm, questionKey } from './form.ts';
import { hhDatabase, openStore } from '../diary/seen-db.ts';
import { canWrite, ownerInsert, ownerWhere } from './owner.ts';

export type ReviewAction = 'approved' | 'rejected' | 'later';

export type DraftSource = {
  kind: 'memory' | 'canon' | 'profile';
  target: string;
  from: string;
  score: number;
  method: string;
  human?: boolean;
};

export type DraftRow = {
  key: string;
  prompt: string;
  answer: string;
  missing: boolean;
  why: string;
  model: string;
  source?: DraftSource;
};

// source = memory/canon target the draft came from; edited = the user changed the drafted text.
export type DecisionAnswer = { key: string; prompt: string; answer: string; source?: string; edited?: boolean; kind?: string; options?: string[]; origin?: 'human' | 'ai' };

export type Decision = {
  id: string;
  action: ReviewAction;
  reason: string;
  answers: DecisionAnswer[];
  row: string;
  at: number;
  until: number;
};

const ready = new WeakSet<sqlite.DatabaseSync>();

export async function reviewDb(): Promise<sqlite.DatabaseSync> {
  await openStore();
  const opened = hhDatabase();
  if (ready.has(opened) === false) {
    opened.exec(`
      CREATE TABLE IF NOT EXISTS waiter_form (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        form TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vacancy_info (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        info TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS review_draft (
        id INTEGER NOT NULL,
        q_key TEXT NOT NULL,
        prompt TEXT NOT NULL,
        draft TEXT NOT NULL,
        missing INTEGER NOT NULL,
        why TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL,
        PRIMARY KEY (id, q_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS answer_memory (
        q_key TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        answer TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS review_decision (
        id INTEGER PRIMARY KEY,
        action TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        answers TEXT NOT NULL DEFAULT '[]',
        row TEXT NOT NULL DEFAULT '',
        at INTEGER NOT NULL,
        until INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_answer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        answer TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memory_unlink (
        q_key TEXT NOT NULL,
        target TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (q_key, target)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS match_cache (
        q_key TEXT NOT NULL,
        target TEXT NOT NULL,
        score REAL NOT NULL,
        method TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (q_key, target, method)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS review_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS embed_cache (
        text_key TEXT NOT NULL,
        model TEXT NOT NULL,
        vec TEXT NOT NULL,
        PRIMARY KEY (text_key, model)
      ) STRICT;
    `);
    addColumn(opened, 'review_draft', 'source', "TEXT NOT NULL DEFAULT ''");
    addColumn(opened, 'answer_memory', 'created', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(opened, 'answer_memory', 'last_used', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(opened, 'answer_memory', 'kind', "TEXT NOT NULL DEFAULT ''");
    addColumn(opened, 'answer_memory', 'options', "TEXT NOT NULL DEFAULT '[]'");
    addColumn(opened, 'answer_memory', 'origin', "TEXT NOT NULL DEFAULT ''");
    addColumn(opened, 'canon_answer', 'created', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(opened, 'canon_answer', 'last_used', 'INTEGER NOT NULL DEFAULT 0');
    opened.exec('UPDATE answer_memory SET created = at WHERE created = 0; UPDATE canon_answer SET created = at WHERE created = 0;');
    ready.add(opened);
  }

  return opened;
}

// Safe migration for tables created before a column existed.
function addColumn(opened: sqlite.DatabaseSync, table: string, column: string, type: string): void {
  const cols = opened.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(col => col.name === column) === false)
    opened.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function num(id: string): number {
  return Number.parseInt(id, 10);
}

export async function saveWaiterForm(id: string, form: CapturedForm): Promise<void> {
  if (/^\d+$/.test(id) === false)
    return;

  (await reviewDb()).prepare('INSERT OR REPLACE INTO waiter_form (id, at, form) VALUES (?, ?, ?)').run(num(id), Date.now(), JSON.stringify(form));
}

export async function readWaiterForms(ids: readonly string[]): Promise<Map<string, CapturedForm>> {
  const out = new Map<string, CapturedForm>();
  const opened = await reviewDb();
  const read = opened.prepare('SELECT form FROM waiter_form WHERE id = ?');
  for (const id of ids) {
    const row = read.get(num(id)) as { form?: string } | undefined;
    const form = row?.form ? asCapturedForm(safeJson(row.form)) : null;
    if (form)
      out.set(id, form);
  }

  return out;
}

export async function readVacancyInfo(ids: readonly string[]): Promise<Map<string, VacancyInfo | null>> {
  const out = new Map<string, VacancyInfo | null>();
  const read = (await reviewDb()).prepare('SELECT info FROM vacancy_info WHERE id = ?');
  for (const id of ids) {
    const row = read.get(num(id)) as { info?: string } | undefined;
    if (row?.info !== undefined)
      out.set(id, safeJson(row.info) as VacancyInfo | null);
  }

  return out;
}

export async function saveVacancyInfo(id: string, info: VacancyInfo | null): Promise<void> {
  (await reviewDb()).prepare('INSERT OR REPLACE INTO vacancy_info (id, at, info) VALUES (?, ?, ?)').run(num(id), Date.now(), JSON.stringify(info));
}

export async function readDrafts(ids: readonly string[]): Promise<Map<string, DraftRow[]>> {
  const out = new Map<string, DraftRow[]>();
  const read = (await reviewDb()).prepare('SELECT q_key, prompt, draft, missing, why, model, source FROM review_draft WHERE id = ?');
  for (const id of ids) {
    const rows = read.all(num(id)) as Array<{ q_key: string; prompt: string; draft: string; missing: number; why: string; model: string; source: string }>;
    if (rows.length > 0)
      out.set(id, rows.map(row => ({ key: row.q_key, prompt: row.prompt, answer: row.draft, missing: row.missing === 1, why: row.why, model: row.model, ...sourceOf(row.source) })));
  }

  return out;
}

export async function saveDrafts(id: string, drafts: readonly DraftRow[]): Promise<void> {
  const write = (await reviewDb()).prepare('INSERT OR REPLACE INTO review_draft (id, q_key, prompt, draft, missing, why, model, source, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of drafts)
    write.run(num(id), row.key, row.prompt, row.answer, row.missing ? 1 : 0, row.why, row.model, row.source ? JSON.stringify(row.source) : '', Date.now());
}

export async function dropDraft(id: string, key: string): Promise<void> {
  (await reviewDb()).prepare('DELETE FROM review_draft WHERE id = ? AND q_key = ?').run(num(id), key);
}

export async function recallAnswers(prompts: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = await reviewDb();
  const own = ownerWhere(db, 'answer_memory');
  const read = db.prepare(`SELECT answer FROM answer_memory WHERE q_key = ? AND ${own.sql}`);
  for (const prompt of prompts) {
    const key = questionKey(prompt);
    const row = read.get(key, ...own.args) as { answer?: string } | undefined;
    if (row?.answer)
      out.set(key, row.answer);
  }

  return out;
}

export async function rememberAnswers(answers: readonly DecisionAnswer[]): Promise<void> {
  const db = await reviewDb();
  if (canWrite(db, 'answer_memory') === false)
    return;

  const ins = ownerInsert(db, 'answer_memory');
  const write = db.prepare(`
    INSERT INTO answer_memory (q_key, prompt, answer, used, at, created, kind, options, origin${ins.col}) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?${ins.ph})
    ON CONFLICT(q_key) DO UPDATE SET answer = excluded.answer, prompt = excluded.prompt, used = used + 1, at = excluded.at,
      kind = CASE WHEN excluded.kind = '' THEN kind ELSE excluded.kind END,
      options = CASE WHEN excluded.options = '[]' THEN options ELSE excluded.options END,
      origin = CASE WHEN excluded.origin = '' THEN origin ELSE excluded.origin END
  `);
  for (const row of answers) {
    const key = questionKey(row.prompt);
    const now = Date.now();
    if (key.length > 0 && row.answer.trim().length > 0)
      write.run(key, row.prompt, row.answer.trim(), now, now, row.kind ?? '', JSON.stringify((row.options ?? []).slice(0, 50)), row.origin ?? '', ...ins.args);
  }
}

export async function saveDecision(decision: Decision): Promise<void> {
  (await reviewDb()).prepare('INSERT OR REPLACE INTO review_decision (id, action, reason, answers, row, at, until) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(num(decision.id), decision.action, decision.reason, JSON.stringify(decision.answers), decision.row, decision.at, decision.until);
}

export async function takeDecision(id: string): Promise<Decision | null> {
  const opened = await reviewDb();
  const row = opened.prepare('SELECT id, action, reason, answers, row, at, until FROM review_decision WHERE id = ?').get(num(id)) as Record<string, unknown> | undefined;
  if (row === undefined)
    return null;

  opened.prepare('DELETE FROM review_decision WHERE id = ?').run(num(id));

  return decisionOf(row);
}

export async function readDecisions(): Promise<Decision[]> {
  const rows = (await reviewDb()).prepare('SELECT id, action, reason, answers, row, at, until FROM review_decision').all() as Array<Record<string, unknown>>;

  return rows.map(decisionOf);
}

function decisionOf(row: Record<string, unknown>): Decision {
  const answers = safeJson(String(row.answers ?? '[]'));

  return {
    id: String(row.id),
    action: String(row.action) as ReviewAction,
    reason: String(row.reason ?? ''),
    answers: Array.isArray(answers) ? answers as DecisionAnswer[] : [],
    row: String(row.row ?? ''),
    at: Number(row.at),
    until: Number(row.until ?? 0),
  };
}

function sourceOf(raw: string): { source?: DraftSource } {
  const parsed = raw ? safeJson(raw) as DraftSource | null : null;

  return parsed && typeof parsed === 'object' ? { source: parsed } : {};
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  }
  catch {
    return null;
  }
}

import { questionKey } from './form.ts';
import { questionType } from './normalize.ts';
import type { DecisionAnswer } from './store.ts';

import { rememberAnswers, reviewDb, safeJson } from './store.ts';
import { canWrite, ownerInsert, ownerWhere } from './owner.ts';

// human = the user typed or corrected this answer; it outranks AI-origin memory.
export type MemoryRow = { key: string; prompt: string; answer: string; human?: boolean };

export type CanonAnswer = { id: number; title: string; answer: string; aliases: string[] };

export async function listMemory(): Promise<MemoryRow[]> {
  const db = await reviewDb();
  const own = ownerWhere(db, 'answer_memory');
  const rows = db.prepare(`SELECT q_key, prompt, answer, origin FROM answer_memory WHERE ${own.sql} ORDER BY at DESC LIMIT 500`).all(...own.args) as Array<{ q_key: string; prompt: string; answer: string; origin: string }>;

  return rows.map(row => ({ key: row.q_key, prompt: row.prompt, answer: row.answer, human: row.origin === 'human' }));
}

export async function listCanon(): Promise<CanonAnswer[]> {
  const db = await reviewDb();
  const own = ownerWhere(db, 'canon_answer');
  const rows = db.prepare(`SELECT id, title, answer, aliases FROM canon_answer WHERE ${own.sql} ORDER BY title`).all(...own.args) as Array<{ id: number; title: string; answer: string; aliases: string }>;

  return rows.map(row => ({ id: Number(row.id), title: row.title, answer: row.answer, aliases: aliasesOf(safeJson(row.aliases)) }));
}

export function aliasesOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : [];

  return [...new Set(list.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(item => item.length > 0))].slice(0, 50);
}

export async function saveCanon(input: { id?: number; title: string; answer: string; aliases: string[] }): Promise<CanonAnswer> {
  const opened = await reviewDb();
  const title = input.title.trim().slice(0, 300);
  const answer = input.answer.trim().slice(0, 4_000);
  const aliases = aliasesOf(input.aliases);
  if (canWrite(opened, 'canon_answer') === false)
    throw new Error('правила этого аккаунта хранятся в расширении');

  const own = ownerWhere(opened, 'canon_answer');
  if (input.id !== undefined && input.id > 0) {
    opened.prepare(`UPDATE canon_answer SET title = ?, answer = ?, aliases = ?, at = ? WHERE id = ? AND ${own.sql}`).run(title, answer, JSON.stringify(aliases), Date.now(), input.id, ...own.args);

    return { id: input.id, title, answer, aliases };
  }

  const ins = ownerInsert(opened, 'canon_answer');
  const done = opened.prepare(`INSERT INTO canon_answer (title, answer, aliases, at, created${ins.col}) VALUES (?, ?, ?, ?, ?${ins.ph})`).run(title, answer, JSON.stringify(aliases), Date.now(), Date.now(), ...ins.args);

  return { id: Number(done.lastInsertRowid), title, answer, aliases };
}

export async function deleteCanon(id: number): Promise<void> {
  const opened = await reviewDb();
  const own = ownerWhere(opened, 'canon_answer');
  const ownU = ownerWhere(opened, 'memory_unlink');
  if (Number(opened.prepare(`DELETE FROM canon_answer WHERE id = ? AND ${own.sql}`).run(id, ...own.args).changes) > 0)
    opened.prepare(`DELETE FROM memory_unlink WHERE target = ? AND ${ownU.sql}`).run(`c:${id}`, ...ownU.args);
}

export async function unlinkAnswer(prompt: string, target: string): Promise<void> {
  const db = await reviewDb();
  if (canWrite(db, 'memory_unlink') === false)
    return;

  const ins = ownerInsert(db, 'memory_unlink');
  db.prepare(`INSERT OR REPLACE INTO memory_unlink (q_key, target, at${ins.col}) VALUES (?, ?, ?${ins.ph})`).run(questionKey(prompt), target, Date.now(), ...ins.args);
}

export async function unlinkedFor(prompt: string): Promise<Set<string>> {
  const db = await reviewDb();
  const own = ownerWhere(db, 'memory_unlink');
  const rows = db.prepare(`SELECT target FROM memory_unlink WHERE q_key = ? AND ${own.sql}`).all(questionKey(prompt), ...own.args) as Array<{ target: string }>;

  return new Set(rows.map(row => row.target));
}

export async function cachedScore(prompt: string, target: string, method: string): Promise<number | null> {
  const row = (await reviewDb()).prepare('SELECT score FROM match_cache WHERE q_key = ? AND target = ? AND method = ?').get(questionKey(prompt), target, method) as { score?: number } | undefined;

  return typeof row?.score === 'number' ? row.score : null;
}

export async function cacheScore(prompt: string, target: string, method: string, score: number): Promise<void> {
  (await reviewDb()).prepare('INSERT OR REPLACE INTO match_cache (q_key, target, method, score, at) VALUES (?, ?, ?, ?, ?)').run(questionKey(prompt), target, method, score, Date.now());
}

export async function cachedVector(text: string, model: string): Promise<number[] | null> {
  const row = (await reviewDb()).prepare('SELECT vec FROM embed_cache WHERE text_key = ? AND model = ?').get(questionKey(text), model) as { vec?: string } | undefined;
  const vec = row?.vec ? safeJson(row.vec) : null;

  return Array.isArray(vec) ? vec as number[] : null;
}

export async function cacheVector(text: string, model: string, vec: readonly number[]): Promise<void> {
  (await reviewDb()).prepare('INSERT OR REPLACE INTO embed_cache (text_key, model, vec) VALUES (?, ?, ?)').run(questionKey(text), model, JSON.stringify(vec));
}

function canonId(target: string | undefined): number {
  const found = /^c:(\d+)$/.exec(target ?? '');

  return found ? Number(found[1]) : 0;
}

// «Ок» with an edited answer: the edit replaces the old value instead of living next to it.
// Memory hit from another question → that memory row takes the new answer too.
// Canon hit → the canon is unlinked for this exact question so the edit wins next time
// (changing the canon itself is what «запомнить как правило» is for).
// Only fields the user changed by hand are stored; untouched AI answers never become «human» memory.
export async function rememberCorrections(answers: readonly DecisionAnswer[]): Promise<void> {
  await rememberAnswers(answers.filter(row => row.edited === true).map(row => ({ ...row, origin: 'human' as const })));
  const opened = await reviewDb();
  for (const row of answers) {
    const answer = row.answer.trim();
    if (row.edited !== true || row.source === undefined || answer.length === 0)
      continue;

    if (row.source.startsWith('m:')) {
      const oldKey = row.source.slice(2);
      if (oldKey !== questionKey(row.prompt))
        if (canWrite(opened, 'answer_memory'))
          opened.prepare(`UPDATE answer_memory SET answer = ?, at = ? WHERE q_key = ? AND ${ownerWhere(opened, 'answer_memory').sql}`).run(answer, Date.now(), oldKey, ...ownerWhere(opened, 'answer_memory').args);
    }
    else if (canonId(row.source) > 0) {
      const canon = opened.prepare(`SELECT answer FROM canon_answer WHERE id = ? AND ${ownerWhere(opened, 'canon_answer').sql}`).get(canonId(row.source), ...ownerWhere(opened, 'canon_answer').args) as { answer?: string } | undefined;
      if (canon?.answer !== undefined && canon.answer.trim() !== answer)
        await unlinkAnswer(row.prompt, row.source);
    }
  }
}

// «запомнить как правило»: create or update one canon rule for this question. The new answer
// replaces the old one; the question becomes an alias; memory for it is overwritten too.
export async function ruleFromAnswer(input: { prompt: string; answer: string; source?: string }): Promise<CanonAnswer> {
  const prompt = input.prompt.replace(/\s+/g, ' ').trim();
  const answer = input.answer.trim();
  const key = questionKey(prompt);
  const canon = await listCanon();
  const byKey = canon.find(item => [item.title, ...item.aliases].some(text => questionKey(text) === key));
  const bySource = canon.find(item => item.id === canonId(input.source));
  const found = byKey ?? bySource;
  const saved = found
    ? await saveCanon({ id: found.id, title: found.title, answer, aliases: [...found.aliases, prompt] })
    : await saveCanon({ title: prompt, answer, aliases: [prompt] });
  const opened = await reviewDb();
  opened.prepare(`DELETE FROM memory_unlink WHERE q_key = ? AND target = ? AND ${ownerWhere(opened, 'memory_unlink').sql}`).run(key, `c:${saved.id}`, ...ownerWhere(opened, 'memory_unlink').args);
  await rememberAnswers([{ key, prompt, answer, origin: 'human' }]);

  return saved;
}

// ---- «Память» tab: one list of remembered answers and canon rules ----

export type LinkedQuestion = { key: string; prompt: string };

export type MemoryEntry = {
  id: string; // m:<q_key> | c:<id>
  kind: 'memory' | 'rule';
  prompt: string;
  answer: string;
  qtype: string; // choice | multi | number | link | yesno | text
  options: string[];
  aliases: string[];
  created: number;
  lastUsed: number;
  used: number;
  matches: number;
  linked: LinkedQuestion[];
  human?: boolean;
};

export async function touchUsed(target: string): Promise<void> {
  const opened = await reviewDb();
  if (target.startsWith('m:'))
    opened.prepare(`UPDATE answer_memory SET last_used = ? WHERE q_key = ? AND ${ownerWhere(opened, 'answer_memory').sql}`).run(Date.now(), target.slice(2), ...ownerWhere(opened, 'answer_memory').args);
  else if (canonId(target) > 0)
    opened.prepare(`UPDATE canon_answer SET last_used = ? WHERE id = ? AND ${ownerWhere(opened, 'canon_answer').sql}`).run(Date.now(), canonId(target), ...ownerWhere(opened, 'canon_answer').args);
}

function typeOf(prompt: string, kind: string): string {
  return kind === 'choice' || kind === 'multi' || kind === 'number' ? kind : questionType(prompt);
}

async function linkedTo(target: string, own: Set<string>): Promise<LinkedQuestion[]> {
  const rows = (await reviewDb()).prepare(`
    SELECT q_key, MAX(prompt) AS prompt FROM review_draft
    WHERE source <> '' AND json_valid(source) AND json_extract(source, '$.target') = ?
    GROUP BY q_key ORDER BY MAX(at) DESC
  `).all(target) as Array<{ q_key: string; prompt: string }>;

  return rows.filter(row => own.has(row.q_key) === false).map(row => ({ key: row.q_key, prompt: row.prompt }));
}

export async function listEntries(): Promise<MemoryEntry[]> {
  const opened = await reviewDb();
  const ownM = ownerWhere(opened, 'answer_memory');
  const ownC = ownerWhere(opened, 'canon_answer');
  const memory = opened.prepare(`SELECT q_key, prompt, answer, used, at, created, last_used, kind, options, origin FROM answer_memory WHERE ${ownM.sql} ORDER BY at DESC LIMIT 1000`).all(...ownM.args) as Array<Record<string, unknown>>;
  const canon = opened.prepare(`SELECT id, title, answer, aliases, at, created, last_used FROM canon_answer WHERE ${ownC.sql} ORDER BY title`).all(...ownC.args) as Array<Record<string, unknown>>;
  const out: MemoryEntry[] = [];
  for (const row of canon) {
    const aliases = aliasesOf(safeJson(String(row.aliases)));
    const title = String(row.title);
    const linked = await linkedTo(`c:${row.id}`, new Set([title, ...aliases].map(questionKey)));
    out.push({ id: `c:${row.id}`, kind: 'rule', prompt: title, answer: String(row.answer), qtype: typeOf(title, ''), options: [], aliases, created: Number(row.created || row.at), lastUsed: Number(row.last_used), used: 0, matches: linked.length, linked });
  }

  for (const row of memory) {
    const key = String(row.q_key);
    const options = safeJson(String(row.options ?? '[]'));
    const human = String(row.origin ?? '') === 'human';
    const linked = await linkedTo(`m:${key}`, new Set([key]));
    out.push({ id: `m:${key}`, kind: 'memory', prompt: String(row.prompt), answer: String(row.answer), qtype: typeOf(String(row.prompt), String(row.kind ?? '')), options: Array.isArray(options) ? options.map(String) : [], aliases: [], created: Number(row.created || row.at), lastUsed: Number(row.last_used), used: Number(row.used), matches: linked.length, linked, human });
  }

  return out;
}

export async function updateEntry(id: string, input: { answer: string; prompt?: string; aliases?: string[] }): Promise<boolean> {
  const answer = input.answer.trim().slice(0, 4_000);
  if (answer.length === 0)
    return false;

  const opened = await reviewDb();
  if (id.startsWith('m:')) {
    return opened.prepare(`UPDATE answer_memory SET answer = ?, at = ? WHERE q_key = ? AND ${ownerWhere(opened, 'answer_memory').sql}`).run(answer, Date.now(), id.slice(2), ...ownerWhere(opened, 'answer_memory').args).changes > 0;
  }

  const found = (await listCanon()).find(item => item.id === canonId(id));
  if (found === undefined)
    return false;

  await saveCanon({ id: found.id, title: input.prompt?.trim() || found.title, answer, aliases: input.aliases ?? found.aliases });

  return true;
}

export async function deleteEntry(id: string): Promise<void> {
  if (canonId(id) > 0) {
    await deleteCanon(canonId(id));

    return;
  }

  const opened = await reviewDb();
  if (Number(opened.prepare(`DELETE FROM answer_memory WHERE q_key = ? AND ${ownerWhere(opened, 'answer_memory').sql}`).run(id.slice(2), ...ownerWhere(opened, 'answer_memory').args).changes) > 0)
    opened.prepare(`DELETE FROM memory_unlink WHERE target = ? AND ${ownerWhere(opened, 'memory_unlink').sql}`).run(id, ...ownerWhere(opened, 'memory_unlink').args);
}

// memory → rule: the remembered answer becomes a canon rule and leaves memory (no duplicates).
export async function entryToRule(id: string): Promise<string | null> {
  const db = await reviewDb();
  const row = db.prepare(`SELECT prompt, answer FROM answer_memory WHERE q_key = ? AND ${ownerWhere(db, 'answer_memory').sql}`).get(id.slice(2), ...ownerWhere(db, 'answer_memory').args) as { prompt?: string; answer?: string } | undefined;
  if (row?.prompt === undefined || row.answer === undefined)
    return null;

  const rule = await ruleFromAnswer({ prompt: row.prompt, answer: row.answer });
  await deleteEntry(id);

  return `c:${rule.id}`;
}

// rule → memory: every wording of the rule becomes a plain memory answer; the rule is removed.
export async function entryToMemory(id: string): Promise<string | null> {
  const found = (await listCanon()).find(item => item.id === canonId(id));
  if (found === undefined)
    return null;

  const prompts = [...new Map([found.title, ...found.aliases].map(text => [questionKey(text), text])).values()];
  await deleteCanon(found.id);
  await rememberAnswers(prompts.map(prompt => ({ key: '', prompt, answer: found.answer, origin: 'human' as const })));

  return `m:${questionKey(found.title)}`;
}

// Clean a bad match: that question never gets this entry again, and its cached draft is dropped.
export async function unlinkLinked(id: string, prompt: string): Promise<void> {
  await unlinkAnswer(prompt, id);
  (await reviewDb()).prepare(`DELETE FROM review_draft WHERE q_key = ? AND source <> '' AND json_valid(source) AND json_extract(source, '$.target') = ?`).run(questionKey(prompt), id);
}

// ---- Canon seed from account data (no person-specific rules in code) ----

export type CanonSeed = { key: string; items: Array<{ title: string; answer: string; aliases: string[] }> };

export function parseCanonSeed(raw: unknown): CanonSeed | null {
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as { key?: unknown; items?: unknown };
  const key = String(row.key ?? '').trim().slice(0, 100);
  const items = (Array.isArray(row.items) ? row.items : []).slice(0, 50).flatMap((item: unknown) => {
    const one = item as Record<string, unknown> | null;
    const title = String(one?.title ?? '').trim().slice(0, 300);
    const answer = String(one?.answer ?? '').trim().slice(0, 4_000);

    return title && answer ? [{ title, answer, aliases: aliasesOf(one?.aliases) }] : [];
  });

  return key && items.length > 0 ? { key, items } : null;
}

// Once per database and seed key: deleting a seeded rule later does not bring it back.
export async function seedCanonOnce(seed: CanonSeed | null): Promise<boolean> {
  if (seed === null)
    return false;

  const opened = await reviewDb();
  if (opened.prepare('SELECT 1 FROM review_meta WHERE key = ?').get(seed.key) !== undefined)
    return false;

  for (const item of seed.items)
    await saveCanon(item);
  opened.prepare('INSERT INTO review_meta (key, value) VALUES (?, ?)').run(seed.key, String(Date.now()));

  return true;
}

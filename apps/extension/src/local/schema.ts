// Local-only user data (lives in chrome.storage.local / IndexedDB of the extension, never on our server).
// Pure module: no chrome APIs, so node tests import it directly.
import type { AccountFacts } from '../../../hh/src/model/copy.ts';
import type { CanonAnswer, CanonSeed, MemoryRow } from '../../../hh/src/review/memory.ts';
import type { Profile } from '../../../hh/src/review/profile.ts';

import { parseProfile } from '../../../hh/src/review/profile.ts';

export const SCHEMA = 'cursor-chrome/local-data';
export const SCHEMA_VERSION = 1;

export type LocalData = {
  schema: typeof SCHEMA;
  version: typeof SCHEMA_VERSION;
  savedAt: number;
  profile: Profile | null;
  facts: AccountFacts;
  canonSeed: CanonSeed | null;
  // «Правила»: canon answers (title + aliases → answer)
  rules: CanonAnswer[];
  // «Память»: remembered answers; human = typed or corrected by the user
  memory: MemoryRow[];
  coverLetter: string;
};

// Property names that must never be exported, imported or synced (LLM / service keys and tokens).
export const SECRET_NAME = /(api[\s_-]?key|apikey|secret|token|password|passwd|authorization|bearer|model[\s_-]?chain|mistral|openai|groq|gemini|anthropic|credential)/i;

export function emptyData(): LocalData {
  return { schema: SCHEMA, version: SCHEMA_VERSION, savedAt: 0, profile: null, facts: { rules: [], notes: '', resume: '' }, canonSeed: null, rules: [], memory: [], coverLetter: '' };
}

// Remove secret-looking properties at any depth.
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(item => stripSecrets(item)) as T;

  if (typeof value !== 'object' || value === null)
    return value;

  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_NAME.test(name) === false)
      out[name] = stripSecrets(item);
  }

  return out as T;
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)).slice(0, max);

function json(raw: unknown): unknown {
  if (typeof raw !== 'string')
    return raw;

  try {
    return JSON.parse(raw) as unknown;
  }
  catch {
    return null;
  }
}

function factsOf(raw: unknown): AccountFacts {
  const row = json(raw) as { rules?: unknown; notes?: unknown; resume?: unknown } | null;
  if (typeof row !== 'object' || row === null)
    return { rules: [], notes: '', resume: '' };

  return {
    rules: (Array.isArray(row.rules) ? row.rules : []).map(item => str(item, 4_000).trim()).filter(Boolean).slice(0, 100),
    notes: str(row.notes, 8_000),
    resume: str(row.resume, 16_000),
  };
}

function aliases(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : [];

  return [...new Set(list.map(item => str(item, 300).replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 50);
}

function seedOf(raw: unknown): CanonSeed | null {
  const row = json(raw) as { key?: unknown; items?: unknown } | null;
  if (typeof row !== 'object' || row === null || Array.isArray(row.items) === false)
    return null;

  const items = row.items.flatMap((item: unknown) => {
    const one = item as Record<string, unknown> | null;
    const title = str(one?.title, 300).trim();
    const answer = str(one?.answer, 4_000).trim();

    return title && answer ? [{ title, answer, aliases: aliases(one?.aliases) }] : [];
  }).slice(0, 500);

  return { key: str(row.key, 100) || 'seed', items };
}

function rulesOf(raw: unknown): CanonAnswer[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item: unknown, index: number) => {
    const one = item as Record<string, unknown> | null;
    const title = str(one?.title, 300).trim();
    const answer = str(one?.answer, 4_000).trim();

    return title && answer ? [{ id: Number(one?.id) > 0 ? Number(one?.id) : index + 1, title, answer, aliases: aliases(one?.aliases) }] : [];
  }).slice(0, 2_000);
}

function memoryOf(raw: unknown): MemoryRow[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item: unknown) => {
    const one = item as Record<string, unknown> | null;
    const prompt = str(one?.prompt, 1_000).trim();
    const answer = str(one?.answer, 4_000).trim();
    if (!prompt || !answer)
      return [];

    return [{ key: str(one?.key, 300) || prompt.toLowerCase(), prompt, answer, ...(one?.human === true ? { human: true } : {}) }];
  }).slice(0, 20_000);
}

export type ParseResult = { ok: true; data: LocalData; dropped: string[] } | { ok: false; error: string };

// Validate an export file or a server account payload. Secrets are dropped and reported, never kept.
export function parseLocalData(raw: unknown, now = Date.now()): ParseResult {
  const value = json(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, error: 'не JSON-объект' };

  const row = value as Record<string, unknown>;
  if (row.schema !== undefined && row.schema !== SCHEMA)
    return { ok: false, error: `чужая схема: ${str(row.schema, 60)}` };

  if (row.version !== undefined && row.version !== SCHEMA_VERSION)
    return { ok: false, error: `неподдерживаемая версия: ${str(row.version, 20)}` };

  const dropped = Object.keys(row).filter(name => SECRET_NAME.test(name));
  const clean = stripSecrets(row);
  const seed = seedOf(clean.canonSeed);
  // Server accounts carry only canonSeed; rules start from it on first import.
  const rules = Array.isArray(clean.rules) ? rulesOf(clean.rules) : rulesOf(seed?.items ?? []);

  return {
    ok: true,
    dropped,
    data: {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      savedAt: Number(clean.savedAt) || now,
      profile: parseProfile(clean.profile),
      facts: factsOf(clean.facts),
      canonSeed: seed,
      rules,
      memory: memoryOf(clean.memory),
      coverLetter: str(clean.coverLetter, 4_000).replace(/\r\n/g, '\n').trim(),
    },
  };
}

// Export file content: whitelist fields only, then strip again as a belt-and-braces check.
export function exportLocalData(data: LocalData, now = Date.now()): string {
  const out: LocalData = {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    savedAt: now,
    profile: data.profile,
    facts: data.facts,
    canonSeed: data.canonSeed,
    rules: data.rules,
    memory: data.memory,
    coverLetter: data.coverLetter,
  };

  return `${JSON.stringify(stripSecrets(out), null, 2)}\n`;
}

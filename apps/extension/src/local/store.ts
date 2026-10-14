// Storage of LocalData inside the extension.
// v2 «split» schema:
//   chrome.storage.local  DATA_KEY  → profile, facts, rules, letter; memory = { where: 'split', count }
//                         INDEX_KEY → light memory index: normalized question → short answer, type, id
//   IndexedDB (extension origin)    → full memory rows (and vectors later)
// Content scripts (hh.ru) read only the index; misses go to the background via a message (full rows from IDB).
// Legacy formats migrated without loss: memory inline in DATA_KEY (v1) and memory fully in IDB ({ where: 'idb' }).
// No localStorage, no cookies.
import type { LocalData } from './schema.ts';
import type { MemoryRow } from '../../../hh/src/review/memory.ts';

import { questionKey } from '../../../hh/src/review/form.ts';
import { questionType } from '../../../hh/src/review/normalize.ts';
import { emptyData, parseLocalData, stripSecrets } from './schema.ts';

export type StorageArea = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

// key = 'memory' for the live rows; other keys used for backups
export type BlobStore = { read: (key?: string) => Promise<unknown>; write: (value: unknown, key?: string) => Promise<void> };

export const DATA_KEY = 'localData:v1';
export const INDEX_KEY = 'memIndex:v2';
export const SCHEMA_KEY = 'localSchema';
export const MEMORY_INLINE_MAX = 1_000_000;
export const SHORT_MAX = 300;
const PROMPT_MAX = 200;

// one index row: k = normalized question, p = question (short), a = answer if short, long = full answer only in IDB
export type IndexRow = { id: number; k: string; p: string; a: string; long: boolean; t: string; h?: boolean };

type MemoryRef = { where: 'idb' | 'split'; count: number };
type Stored = Omit<LocalData, 'memory'> & { memory: MemoryRow[] | MemoryRef };

export type StoreLayout = { schema: 'empty' | 'v1-inline' | 'v1-idb' | 'v2-split'; indexRows: number; longRows: number; idbRows: number | null; storageBytes: number };

export function buildIndex(memory: readonly MemoryRow[]): IndexRow[] {
  return memory.map((row, id) => {
    const long = row.answer.length > SHORT_MAX;

    return { id, k: questionKey(row.prompt), p: row.prompt.slice(0, PROMPT_MAX), a: long ? '' : row.answer, long, t: questionType(row.prompt), ...(row.human ? { h: true } : {}) };
  });
}

// memory as seen from the index only (content scripts): long answers are left out (looked up in the background)
export function indexMemory(index: readonly IndexRow[]): MemoryRow[] {
  return index.filter(row => row.long === false && row.a.length > 0).map(row => ({ key: row.k, prompt: row.p, answer: row.a, ...(row.h ? { human: true } : {}) }));
}

export function createLocalStore(area: StorageArea, big?: BlobStore) {
  async function raw(): Promise<{ data: Stored | undefined; index: IndexRow[] | undefined }> {
    const got = await area.get([DATA_KEY, INDEX_KEY]);

    return { data: got[DATA_KEY] as Stored | undefined, index: got[INDEX_KEY] as IndexRow[] | undefined };
  }

  async function memoryOf(stored: Stored, index: IndexRow[] | undefined): Promise<MemoryRow[]> {
    if (Array.isArray(stored.memory))
      return stored.memory;

    if (big) {
      const rows = await big.read('memory');
      if (Array.isArray(rows))
        return rows as MemoryRow[];
    }

    return indexMemory(index ?? []);
  }

  async function load(): Promise<LocalData | null> {
    const { data, index } = await raw();
    if (data === undefined || data === null)
      return null;

    const parsed = parseLocalData({ ...data, memory: await memoryOf(data, index) });

    return parsed.ok ? parsed.data : null;
  }

  async function save(data: LocalData): Promise<void> {
    const clean = stripSecrets({ ...data, savedAt: Date.now() });
    if (big) {
      await big.write(clean.memory, 'memory');
      await area.set({ [DATA_KEY]: { ...clean, memory: { where: 'split', count: clean.memory.length } }, [INDEX_KEY]: buildIndex(clean.memory), [SCHEMA_KEY]: 2 });

      return;
    }
    // no IndexedDB in this context (tests / legacy): keep everything inline, index still written for content scripts
    await area.set({ [DATA_KEY]: clean, [INDEX_KEY]: buildIndex(clean.memory) });
  }

  async function layout(): Promise<StoreLayout> {
    const { data, index } = await raw();
    const all = await area.get([DATA_KEY, INDEX_KEY]);
    const storageBytes = JSON.stringify(all).length;
    const idb = big ? await big.read('memory') : null;
    const idbRows = Array.isArray(idb) ? idb.length : null;
    const schema = !data ? 'empty' : Array.isArray(data.memory) ? 'v1-inline' : data.memory.where === 'idb' ? 'v1-idb' : 'v2-split';

    return { schema, indexRows: index?.length ?? 0, longRows: index?.filter(row => row.long).length ?? 0, idbRows, storageBytes };
  }

  // Idempotent migration to v2-split. Backs up first (small part in storage, memory in IDB under a backup key).
  async function migrate(now = Date.now()): Promise<{ from: StoreLayout['schema']; to: StoreLayout['schema']; rows: number; backup: string | null }> {
    const before = await layout();
    if (before.schema === 'empty' || before.schema === 'v2-split' || !big)
      return { from: before.schema, to: before.schema, rows: before.indexRows, backup: null };

    const { data, index } = await raw();
    const memory = await memoryOf(data!, index);
    const backup = `localData:backup:${now}`;
    const { memory: _skip, ...small } = data!;
    await big.write(memory, `backup-${now}`);
    await area.set({ [backup]: { ...small, memory: { where: 'idb-backup', key: `backup-${now}`, count: memory.length }, from: before.schema } });
    const loaded = await load();
    await save({ ...loaded!, memory });
    const after = await layout();

    return { from: before.schema, to: after.schema, rows: memory.length, backup };
  }

  return {
    load,
    save,
    layout,
    migrate,
    // content-script view: small data + index-backed memory, never touches IndexedDB
    async loadIndexed(): Promise<{ data: LocalData; hasLong: boolean } | null> {
      const { data, index } = await raw();
      if (!data)
        return null;

      const memory = Array.isArray(data.memory) ? data.memory : indexMemory(index ?? []);
      const parsed = parseLocalData({ ...data, memory });
      const hasLong = Array.isArray(data.memory) ? false : (index ?? []).some(row => row.long) || index === undefined;

      return parsed.ok ? { data: parsed.data, hasLong } : null;
    },
    async loadOrEmpty(): Promise<LocalData> {
      return (await load()) ?? emptyData();
    },
    async initialized(): Promise<boolean> {
      return (await raw()).data !== undefined;
    },
    async update(change: (data: LocalData) => LocalData): Promise<LocalData> {
      const next = change((await load()) ?? emptyData());
      await save(next);

      return next;
    },
  };
}

export type LocalStore = ReturnType<typeof createLocalStore>;

// IndexedDB blobs (extension origin only).
export function idbBlob(name = 'cursor-chrome-local'): BlobStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();

    return new Promise<T>((resolve, reject) => {
      const req = act(db.transaction('blobs', mode).objectStore('blobs'));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  };

  return {
    read: async (key = 'memory') => (await run<unknown>('readonly', store => store.get(key))) ?? null,
    write: async (value, key = 'memory') => {
      await run('readwrite', store => store.put(value, key));
    },
  };
}

// Stage D: pull GET /api/ext/config (ETag/304), cache it in extConfig:v1, and seed the admin once
// with local values when the admin has none. LLM keys are never part of this (only MANAGED booleans).
import type { AdminSettings, ExtConfigCache } from './ext-settings.ts';

import { cleanSettings, EXT_CONFIG_KEY, EXT_SEED_KEY, MANAGED } from './ext-settings.ts';

export type SyncDeps = {
  base: () => Promise<string>;
  key: () => Promise<string>;
  gateOpen: () => Promise<boolean>;
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  fetcher?: typeof fetch;
  now?: () => number;
};
export type SyncEnd = 'closed' | 'fresh' | 'same' | 'seeded' | 'failed';

export async function syncExtConfig(d: SyncDeps): Promise<SyncEnd> {
  const fetcher = d.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = d.now ?? Date.now;
  if (await d.gateOpen() === false)
    return 'closed';

  const base = (await d.base()).trim().replace(/\/+$/, '');
  const key = (await d.key()).trim();
  if (!base || !key)
    return 'closed';

  const auth = { authorization: `Bearer ${key}` };
  const stored = await d.get([EXT_CONFIG_KEY, EXT_SEED_KEY, 'flags']);
  const cache = stored[EXT_CONFIG_KEY] as Partial<ExtConfigCache> | undefined;
  const pull = async (etag: string): Promise<{ status: 'fresh' | 'same' | 'failed'; settings: AdminSettings | null }> => {
    try {
      const res = await fetcher(`${base}/api/ext/config`, { cache: 'no-store', headers: etag ? { ...auth, 'if-none-match': etag } : auth });
      if (res.status === 304)
        return { status: 'same', settings: cleanSettings(cache?.settings) };

      if (res.status !== 200)
        return { status: 'failed', settings: null };

      const body = await res.json() as { settings?: unknown };
      if ((await d.key()).trim() !== key) return {status:'failed',settings:null};
      const settings = cleanSettings(body?.settings);
      await d.set({ [EXT_CONFIG_KEY]: { etag: res.headers.get('etag') ?? '', settings, at: now() } satisfies ExtConfigCache });

      return { status: 'fresh', settings };
    }
    catch {
      return { status: 'failed', settings: null };
    }
  };
  const first = await pull(typeof cache?.etag === 'string' ? cache.etag : '');
  if (first.status === 'failed' || MANAGED.some(name => typeof first.settings?.[name] === 'boolean') || stored[EXT_SEED_KEY] === true)
    return first.status;

  // admin is empty: hand over local values once (only if the user ever set them locally)
  const local = stored.flags;
  if (local === null || typeof local !== 'object')
    return first.status;

  const values: Record<string, boolean> = {};
  for (const name of MANAGED) {
    const v = (local as Record<string, unknown>)[name];
    if (typeof v === 'boolean')
      values[name] = v;
  }

  if (Object.keys(values).length === 0)
    return first.status;

  try {
    const res = await fetcher(`${base}/api/ext/config/seed`, { method: 'POST', cache: 'no-store', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(values) });
    if (res.status !== 200)
      return first.status;
  }
  catch {
    return first.status;
  }

  await d.set({ [EXT_SEED_KEY]: true });
  await pull('');

  return 'seeded';
}

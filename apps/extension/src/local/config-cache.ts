// Remote config (/api/config): hh selectors, dictionaries, rule order. Cached in chrome.storage.local with its
// ETag; the last valid config is used when the server is down or sends junk; built-in defaults otherwise.
import type { StorageArea } from './store.ts';

export const CONFIG_KEY = 'remoteConfig:v1';

export type RemoteConfig = {
  version: number;
  selectors: Record<string, string>;
  dictionaries: Record<string, string[]>;
  order: string[];
};

export const BUILTIN: RemoteConfig = {
  version: 0,
  selectors: {
    taskQuestion: '[data-qa="task-question"]',
    letterToggle: '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"]',
    letterField: 'textarea[data-qa*="letter"], [data-qa*="letter"] textarea',
    xaiLogin: 'a[href*="sign-in"], a[href*="login"], button[data-provider="google"], [data-testid*="sign-in"]',
    xaiApiKeys: 'a[href*="/api-keys"]',
    xaiCreateKey: '[data-testid*="create-api-key"], button[aria-label*="Create API key" i]',
    xaiCopyKey: '[data-testid*="copy"], button[aria-label*="Copy" i]',
  },
  dictionaries: { skillJunk: ['php', 'bitrix', 'битрикс', '1с', '1c', 'react native'] },
  order: ['rule', 'profile', 'human', 'memory', 'llm'],
};

export function validConfig(raw: unknown): RemoteConfig | null {
  const row = raw as Partial<RemoteConfig> | null;
  if (!row || typeof row.version !== 'number' || typeof row.selectors !== 'object' || row.selectors === null || !Array.isArray(row.order))
    return null;

  const selectors = Object.fromEntries(Object.entries(row.selectors).filter(([, value]) => typeof value === 'string' && value.length > 0 && value.length < 500));
  const dictionaries = Object.fromEntries(Object.entries(row.dictionaries ?? {}).filter(([, value]) => Array.isArray(value)).map(([name, value]) => [name, (value as unknown[]).map(String)]));

  return { version: row.version, selectors, dictionaries, order: row.order.map(String) };
}

export async function cachedConfig(area: StorageArea): Promise<RemoteConfig> {
  const saved = (await area.get(CONFIG_KEY))[CONFIG_KEY] as { config?: unknown } | undefined;

  return validConfig(saved?.config) ?? BUILTIN;
}

export async function refreshConfig(area: StorageArea, base: string, version = '', fetcher: typeof fetch = fetch): Promise<{ config: RemoteConfig; from: 'server' | 'cache' | 'builtin' }> {
  const saved = (await area.get(CONFIG_KEY))[CONFIG_KEY] as { config?: unknown; etag?: string } | undefined;
  const last = validConfig(saved?.config);
  const fallback = { config: last ?? BUILTIN, from: last ? 'cache' as const : 'builtin' as const };
  if (!base)
    return fallback;

  try {
    const headers: Record<string, string> = version ? { 'x-ext-version': version } : {};
    if (last && saved?.etag)
      headers['if-none-match'] = saved.etag;
    const res = await fetcher(`${base}/api/config`, { headers });
    if (res.status === 304 && last)
      return { config: last, from: 'cache' };
    if (res.ok === false)
      return fallback;

    const fresh = validConfig(await res.json());
    if (fresh === null)
      return fallback;

    await area.set({ [CONFIG_KEY]: { config: fresh, etag: res.headers.get('etag') ?? '', at: Date.now() } });

    return { config: fresh, from: 'server' };
  }
  catch {
    return fallback;
  }
}

export function selector(config: RemoteConfig, name: keyof typeof BUILTIN.selectors | string): string {
  return config.selectors[name] || BUILTIN.selectors[name] || '';
}

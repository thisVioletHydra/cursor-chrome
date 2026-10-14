// BYOK: the user's own LLM key, encrypted with WebCrypto (AES-GCM) in chrome.storage.local.
// The AES key is a non-extractable CryptoKey kept in the extension's IndexedDB (injectable for tests).
// Sent only as the x-llm-key header of /api/answer; never exported, synced or logged.
import type { StorageArea } from './store.ts';

export const BYOK_KEY = 'byok:v1';

export type KeyStore = { get: () => Promise<CryptoKey | null>; put: (key: CryptoKey) => Promise<void> };
export type ByokState = { provider: string; iv: string; data: string; tail: string };

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

async function aesKey(store: KeyStore): Promise<CryptoKey> {
  const have = await store.get();
  if (have)
    return have;

  const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store.put(made);

  return made;
}

export async function saveByok(area: StorageArea, store: KeyStore, provider: string, llmKey: string): Promise<void> {
  const text = llmKey.trim();
  if (!text) {
    await area.set({ [BYOK_KEY]: null });

    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(store), new TextEncoder().encode(text)));
  await area.set({ [BYOK_KEY]: { provider, iv: b64(iv), data: b64(data), tail: text.slice(-4) } satisfies ByokState });
}

export async function loadByok(area: StorageArea, store: KeyStore): Promise<{ provider: string; key: string } | null> {
  const state = (await area.get(BYOK_KEY))[BYOK_KEY] as ByokState | null | undefined;
  if (!state?.data)
    return null;

  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(state.iv) }, await aesKey(store), unb64(state.data));

    return { provider: state.provider, key: new TextDecoder().decode(plain) };
  }
  catch {
    return null;
  }
}

export async function byokInfo(area: StorageArea): Promise<{ on: boolean; provider: string; tail: string }> {
  const state = (await area.get(BYOK_KEY))[BYOK_KEY] as ByokState | null | undefined;

  return { on: Boolean(state?.data), provider: state?.provider ?? '', tail: state?.tail ?? '' };
}

// IndexedDB keystore (extension origin): the CryptoKey is stored as a structured-clone, non-extractable.
export function idbKeyStore(name = 'cc-keys'): KeyStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('k');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();

    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction('k', mode).objectStore('k'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  return {
    get: async () => (await run<CryptoKey | undefined>('readonly', store => store.get('aes') as IDBRequest<CryptoKey | undefined>)) ?? null,
    put: async (key) => { await run('readwrite', store => store.put(key, 'aes')); },
  };
}

// The real store: chrome.storage.local + IndexedDB for big memory.
import { browser } from '../browser-host';
import { createLocalStore, idbBlob } from './store.ts';

export const localStore = createLocalStore({
  get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: items => browser.storage.local.set(items),
}, extensionOrigin() ? idbBlob() : undefined);

// IndexedDB only on the extension's own origin: in a content script indexedDB belongs to the page (hh.ru).
function extensionOrigin(): boolean {
  return typeof indexedDB !== 'undefined' && /^(chrome|moz)-extension:$/.test(globalThis.location?.protocol ?? '');
}

export type BrowserKind = 'firefox' | 'edge' | 'chrome' | 'other';

type ExtensionGlobals = typeof globalThis & {
  browser?: typeof chrome;
  chrome?: typeof chrome;
};

function detectKind(): BrowserKind {
  const ua = globalThis.navigator?.userAgent ?? '';
  if (ua.includes('Firefox'))
    return 'firefox';

  if (ua.includes('Edg/'))
    return 'edge';

  if (typeof (globalThis as ExtensionGlobals).chrome !== 'undefined' || ua.includes('Chrome'))
    return 'chrome';

  return 'other';
}

function pickHost(): typeof chrome {
  const g = globalThis as ExtensionGlobals;
  if (g.browser?.runtime)
    return g.browser;

  if (g.chrome)
    return g.chrome;

  throw new Error('No WebExtension API (browser/chrome) on globalThis');
}

export const browserKind: BrowserKind = detectKind();
export const browser: typeof chrome = pickHost();

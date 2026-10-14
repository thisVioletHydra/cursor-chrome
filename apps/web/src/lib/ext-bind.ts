// Admin «До старта»: extension status from the content-script mark on this page + the server's last-seen lamp.
// mark: <html data-nojob-ext="linked|unlinked"> set by the extension on our admin page only; '' = no extension here.
export const EXT_MARK_ATTR = 'data-nojob-ext';
export const EXT_MARK_EVENT = 'nojob-ext-mark';

export type ExtMark = '' | 'linked' | 'unlinked';
export type ExtBind = 'linked' | 'unlinked' | 'missing' | 'stale';

export function readMark(value: unknown): ExtMark {
  return value === 'linked' || value === 'unlinked' ? value : '';
}

export function extBindState(mark: ExtMark, seen: string): ExtBind {
  if (mark === 'linked')
    return 'linked';
  if (mark === 'unlinked')
    return 'unlinked';
  if (seen === 'ok')
    return 'linked';

  return seen === 'stale' ? 'stale' : 'missing';
}

// The key is never in the HTML: fetched on click via POST /admin/ext-token and turned into the connect link.
export async function fetchConnectLink(origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher('/admin/ext-token', { method: 'POST', headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
  const body = res.ok ? await res.json().catch(() => null) as { token?: unknown } | null : null;
  const token = typeof body?.token === 'string' ? body.token : '';

  return token.length > 0 ? `${origin}/connect#${token}` : '';
}

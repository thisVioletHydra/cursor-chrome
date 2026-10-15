// Search page parsing (ported from hh-search.ts cardOf/collect). Runs on HTML the extension reports.
export interface Card { id: string; title: string; company: string; url: string }
export const FEED = 'https://hh.ru/search/vacancy?enable_snippets=true&ored_clusters=true&search_period=7';
export const LIGHT = 'https://hh.ru/search/vacancy?enable_snippets=true&ored_clusters=true&work_format=REMOTE&search_period=1';

export function searchUrl(base: string, opts: { text?: string; page?: number } = {}): string {
  const u = new URL(base);
  if (opts.text)
    u.searchParams.set('text', opts.text);
  if (opts.page && opts.page > 0)
    u.searchParams.set('page', String(opts.page));
  return u.toString();
}

const decode = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function textAt(chunk: string, qa: string): string {
  const at = chunk.indexOf(`data-qa="${qa}"`);
  if (at < 0)
    return '';
  const open = chunk.indexOf('>', at);
  const tag = chunk.lastIndexOf('<', at);
  const name = chunk.slice(tag + 1).match(/^[a-z0-9]+/i)?.[0] ?? 'span';
  const close = chunk.indexOf(`</${name}>`, open);
  return decode(chunk.slice(open + 1, close < 0 ? open + 400 : close));
}

export function parseSerp(html: string): { cards: Card[]; more: boolean } {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const id = chunk.match(/\/vacancy\/(\d+)/)?.[1] ?? '';
    const title = textAt(chunk, 'serp-item__title');
    if (!id || !title || seen.has(id))
      continue;
    seen.add(id);
    cards.push({ id, title, company: textAt(chunk, 'vacancy-serp__vacancy-employer') || 'без компании', url: `https://hh.ru/vacancy/${id}` });
  }
  return { cards, more: html.includes('data-qa="pager-next"') };
}

const LOOK = 40;
const SEARCH = 'https://hh.ru/search/vacancy';

export type FoundCard = {
  id: string;
  title: string;
  company: string;
  url: string;
  text: string;
  salaryFrom: number | null;
  salaryTo: number | null;
  currency: string;
  remote: boolean;
  experience: string;
};

export async function collectVacancies(queries: string[]): Promise<{ login: boolean; cards: FoundCard[] }> {
  const cards: FoundCard[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    if (cards.length >= LOOK)
      break;

    for (const page of [0, 1]) {
      if (cards.length >= LOOK)
        break;

      const pulled = await pull(searchUrl(query, page));
      if (pulled === null)
        break;

      if (isLogin(pulled.url, pulled.html))
        return { login: true, cards };

      const batch = cardsOf(pulled.html);
      if (batch.length === 0)
        break;

      for (const card of batch) {
        if (seen.has(card.id) || cards.length >= LOOK)
          continue;

        seen.add(card.id);
        cards.push(card);
      }

      await pause(1500, 4000);
    }
  }

  for (const card of cards) {
    const pulled = await pull(card.url);
    if (pulled !== null && isLogin(pulled.url, pulled.html))
      return { login: true, cards };

    if (pulled !== null)
      fillText(card, pulled.html);

    await pause(400, 1200);
  }

  return { login: false, cards };
}

function searchUrl(query: string, page: number): string {
  const url = new URL(SEARCH);
  url.searchParams.set('text', query);
  url.searchParams.set('search_period', '3');
  url.searchParams.set('order_by', 'publication_time');
  url.searchParams.set('page', String(page));

  return url.toString();
}

async function pull(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      headers: { accept: 'text/html' },
    });
    if (res.ok === false)
      return null;

    return { url: res.url, html: await res.text() };
  }
  catch {
    return null;
  }
}

function isLogin(url: string, html: string): boolean {
  return url.includes('/account/login') || html.includes('data-qa="account-login"');
}

function cardsOf(html: string): FoundCard[] {
  const chunks = html.split('data-qa="vacancy-serp__vacancy"').slice(1);
  const cards: FoundCard[] = [];
  for (const chunk of chunks) {
    const card = cardOf(chunk);
    if (card !== null)
      cards.push(card);
  }

  return cards;
}

function cardOf(chunk: string): FoundCard | null {
  const id = chunk.match(/\/vacancy\/(\d+)/)?.[1] ?? '';
  const title = textAt(chunk, 'serp-item__title');
  if (id.length === 0 || title.length === 0)
    return null;

  const company = textAt(chunk, 'vacancy-serp__vacancy-employer');
  const place = textAt(chunk, 'vacancy-serp__vacancy-address');
  const pay = salaryOf(textAt(chunk, 'vacancy-serp__vacancy-compensation'));
  const snippet = decode(chunk.slice(0, 4000)).slice(0, 500);

  return {
    id,
    title,
    company: company.length > 0 ? company : 'без компании',
    url: `https://hh.ru/vacancy/${id}`,
    text: snippet.length > 0 ? snippet : title,
    salaryFrom: pay.from,
    salaryTo: pay.to,
    currency: pay.currency,
    remote: /удал[её]н|remote/i.test(`${place} ${snippet}`),
    experience: '',
  };
}

function fillText(card: FoundCard, html: string): void {
  const at = html.indexOf('data-qa="vacancy-description"');
  const text = at < 0 ? '' : decode(html.slice(at, at + 20_000)).slice(0, 6000);
  if (text.length > 0)
    card.text = text;

  const experience = textAt(html, 'vacancy-experience');
  if (experience.length > 0)
    card.experience = experience.slice(0, 80);
}

function textAt(html: string, qa: string): string {
  const at = html.indexOf(`data-qa="${qa}"`);
  if (at < 0)
    return '';

  const block = html.slice(at, at + 800);
  const close = block.indexOf('>');
  if (close < 0)
    return '';

  const rest = block.slice(close + 1);
  const end = rest.search(/<\/(a|span|div|h\d)/i);

  return decode(end < 0 ? rest : rest.slice(0, end));
}

function currencyOf(text: string): string {
  if (/₽|руб/i.test(text))
    return 'RUR';

  if (/\$|USD/i.test(text))
    return 'USD';

  if (/€|EUR/i.test(text))
    return 'EUR';

  return '';
}

function salaryOf(text: string): { from: number | null; to: number | null; currency: string } {
  const currency = currencyOf(text);
  const numbers = [...text.replace(/\s/g, '').matchAll(/\d+/g)].map(item => Number(item[0]));
  const fromTo = text.includes('от') && text.includes('до');
  if (fromTo && numbers.length >= 2)
    return { from: numbers[0], to: numbers[1], currency };

  if (text.includes('от') && numbers.length > 0)
    return { from: numbers[0], to: null, currency };

  if (text.includes('до') && numbers.length > 0)
    return { from: null, to: numbers[0], currency };

  if (numbers.length >= 2)
    return { from: numbers[0], to: numbers[1], currency };

  if (numbers.length === 1)
    return { from: numbers[0], to: null, currency };

  return { from: null, to: null, currency };
}

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function pause(min: number, max: number): Promise<void> {
  const ms = min + Math.floor(Math.random() * (max - min));

  return new Promise(resolve => setTimeout(resolve, ms));
}

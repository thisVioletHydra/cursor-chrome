import type { Vacancy } from './rules.ts';

import { appToken } from './hh-token.ts';
import { HH_API, HH_USER_AGENT, PING_MS } from '../limits.ts';
import { splitQueries } from '../mix/queries.ts';

type SearchItem = {
  id: string;
  name: string;
  alternate_url: string;
  employer?: { name?: string };
  snippet?: { requirement?: string; responsibility?: string };
};

type SearchPage = { items?: SearchItem[] };

type VacancyCard = {
  id: string;
  name: string;
  alternate_url: string;
  description?: string;
  employer?: { id?: string; name?: string };
  salary?: { from?: number | null; to?: number | null; currency?: string | null } | null;
  schedule?: { id?: string } | null;
  work_format?: { id?: string }[] | null;
  experience?: { id?: string } | null;
};

const FRESH_DAYS = 3;

const FORM = /https:\/\/docs\.google\.com\/forms\/[^\s"'<>]+/i;

export async function searchVacancies(query: string, limit: number): Promise<Vacancy[]> {
  const queries = splitQueries(query);
  if (queries.length === 0)
    return [];

  const token = await appToken();
  if (token.length === 0)
    throw new Error('нет токена приложения hh');

  const perQuery = Math.ceil(limit / queries.length);
  const pages = await Promise.all(queries.flatMap(text => [0, 1].map(page => searchPage(text, perQuery, page, token))));
  const unique = new Map<string, SearchItem>();
  for (const item of pages.flat()) {
    if (unique.has(item.id) === false)
      unique.set(item.id, item);
  }

  return Promise.all([...unique.values()].slice(0, limit).map(item => loadCard(item, token)));
}

async function searchPage(text: string, limit: number, page: number, token: string): Promise<SearchItem[]> {
  const url = new URL(`${HH_API}/vacancies`);
  url.searchParams.set('text', text);
  url.searchParams.set('per_page', String(Math.min(limit, 100)));
  url.searchParams.set('page', String(page));
  url.searchParams.set('period', String(FRESH_DAYS));
  url.searchParams.set('order_by', 'publication_time');
  const found = await hhGet<SearchPage>(url, token);

  return found.items ?? [];
}

async function loadCard(item: SearchItem, token: string): Promise<Vacancy> {
  const card = await hhGet<VacancyCard>(`${HH_API}/vacancies/${item.id}`, token);
  const text = strip(card.description || `${item.snippet?.requirement ?? ''} ${item.snippet?.responsibility ?? ''}`);
  const formUrl = text.match(FORM)?.[0] ?? '';
  const remote = card.schedule?.id === 'remote' || (card.work_format ?? []).some(format => format.id === 'REMOTE');

  return {
    id: item.id,
    title: card.name || item.name,
    company: card.employer?.name || item.employer?.name || 'без компании',
    url: card.alternate_url || item.alternate_url,
    text,
    formUrl,
    formBlocked: false,
    salaryFrom: card.salary?.from ?? null,
    salaryTo: card.salary?.to ?? null,
    currency: card.salary?.currency ?? '',
    remote,
    employerId: card.employer?.id ?? '',
    experience: card.experience?.id ?? '',
  };
}

export async function hhGet<T>(url: URL | string, token = ''): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': HH_USER_AGENT,
  };
  if (token.length > 0)
    headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(PING_MS) });
  if (res.ok === false)
    throw new Error(`hh ${res.status}`);

  return await res.json() as T;
}

export function strip(html: string): string {
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

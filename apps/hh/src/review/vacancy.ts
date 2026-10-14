import { readVacancyInfo, saveVacancyInfo } from './store.ts';

import timers from 'node:timers/promises';

export type VacancyInfo = {
  id: string;
  title: string;
  company: string;
  city: string;
  format: string;
  office: boolean;
  salaryFrom: number | null;
  salaryTo: number | null;
  currency: string;
  salaryText: string;
  url: string;
  description: string;
};

type Named = { id?: string; name?: string };

type HhVacancy = {
  name?: string;
  alternate_url?: string;
  area?: Named;
  employer?: { name?: string };
  schedule?: Named;
  work_format?: Named[];
  salary_range?: { from?: number | null; to?: number | null; currency?: string } | null;
  salary?: { from?: number | null; to?: number | null; currency?: string } | null;
  description?: string;
};

const API = 'https://api.hh.ru/vacancies/';
const GAP_MS = 1_500;
const TIMEOUT_MS = 10_000;
const AGENT = 'cursor-chrome-review/1.0 (read-only)';

let line: Promise<unknown> = Promise.resolve();
let lastAt = 0;

// Read-only public GET, one request at a time with a gap, cached forever in vacancy_info.
export async function vacancyInfo(id: string): Promise<VacancyInfo | null> {
  if (/^\d+$/.test(id) === false)
    return null;

  const cached = await readVacancyInfo([id]);
  if (cached.has(id))
    return cached.get(id) ?? null;

  const job = line.then(() => fetchOnce(id));
  line = job.catch(() => null);

  return job;
}

async function fetchOnce(id: string): Promise<VacancyInfo | null> {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0)
    await timers.setTimeout(wait);

  lastAt = Date.now();
  const res = await fetch(`${API}${id}`, {
    headers: { 'user-agent': AGENT, 'hh-user-agent': AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 403) {
    await saveVacancyInfo(id, null);

    return null;
  }

  if (res.ok === false)
    throw new Error(`hh ${res.status}`);

  const info = parseVacancy(id, await res.json() as HhVacancy);
  await saveVacancyInfo(id, info);

  return info;
}

export function parseVacancy(id: string, raw: HhVacancy): VacancyInfo {
  const formats = (raw.work_format ?? []).map(item => item.id ?? '');
  const salary = raw.salary_range ?? raw.salary ?? null;
  const from = typeof salary?.from === 'number' ? salary.from : null;
  const to = typeof salary?.to === 'number' ? salary.to : null;
  const currency = salary?.currency ?? '';

  return {
    id,
    title: raw.name ?? '',
    company: raw.employer?.name ?? '',
    city: raw.area?.name ?? '',
    format: formatText(raw),
    office: isOffice(formats, raw.schedule?.id ?? ''),
    salaryFrom: from,
    salaryTo: to,
    currency,
    salaryText: salaryText(from, to, currency),
    url: raw.alternate_url ?? `https://hh.ru/vacancy/${id}`,
    description: stripHtml(raw.description ?? '').slice(0, 4_000),
  };
}

function formatText(raw: HhVacancy): string {
  const names = (raw.work_format ?? []).map(item => item.name ?? '').filter(name => name.length > 0);
  if (names.length > 0)
    return names.join(', ');

  return raw.schedule?.name ?? '';
}

function isOffice(formats: readonly string[], schedule: string): boolean {
  if (formats.length > 0)
    return formats.includes('REMOTE') === false;

  return schedule.length > 0 && schedule !== 'remote';
}

function salaryText(from: number | null, to: number | null, currency: string): string {
  const cur = currency === 'RUR' ? '₽' : currency;
  const fmt = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
  if (from !== null && to !== null)
    return `${fmt(from)}–${fmt(to)} ${cur}`;

  if (from !== null)
    return `от ${fmt(from)} ${cur}`;

  if (to !== null)
    return `до ${fmt(to)} ${cur}`;

  return '';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function topSalary(info: VacancyInfo | null): number | null {
  if (info === null || info.currency !== 'RUR')
    return null;

  return info.salaryTo ?? info.salaryFrom;
}

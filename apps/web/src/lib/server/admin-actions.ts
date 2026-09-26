import type { RequestEvent } from '@sveltejs/kit';
import type { Stored } from './secrets';

import { asProvider, COVER_LETTER, splitQueries, suggestQueries } from '@cursor-chrome/hh';
import { error } from '@sveltejs/kit';
import { probeHh, probeModel, probeTelegram } from './checks';
import { chainOf, isCreator, newExtToken, publishSecrets, readAccount, withChain, writeAccount } from './secrets';
import { allowedLogins, readSession } from './session';

const sections = ['telegram', 'model', 'hh'] as const;
type Section = typeof sections[number];

const coolUntil = new Map<Section, number>();

function guard(cookies: RequestEvent['cookies']): string {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    error(401, 'нет');

  return session.login;
}

function sectionOf(form: FormData): Section | null {
  const value = String(form.get('section') ?? '');

  return sections.includes(value as Section) ? value as Section : null;
}

function cooling(section: Section): number {
  const left = (coolUntil.get(section) ?? 0) - Date.now();

  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export function coolLeft(section: Section): number {
  return cooling(section);
}

function hold(section: Section, retryAfter: number): number {
  if (retryAfter < 1)
    return 0;

  coolUntil.set(section, Date.now() + retryAfter * 1000);

  return retryAfter;
}

function viewingGuest(cookies: RequestEvent['cookies'], login: string): boolean {
  return isCreator(login) && cookies.get('preview') === 'guest';
}

export async function verifyAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };
  const form = await request.formData();
  const section = sectionOf(form);
  if (section === null || section === 'model')
    return { ok: false, detail: 'раздел не тот', wait: 0 };

  const left = cooling(section);
  if (left > 0)
    return { ok: false, detail: 'подожди', wait: left };

  const saved = await readAccount(login);
  const next = { ...saved };
  if (section === 'hh') {
    const token = String(form.get('hhAccessToken') ?? '').trim() || saved.hhAccessToken;
    const rawResume = String(form.get('hhResumeId') ?? '').trim();
    form.set('hhAccessToken', token);
    form.set('hhResumeId', resumeIdOf(rawResume || saved.hhResumeId));
  }
  const probe = await probeSection(section, form);
  const wait = probe.ok ? 0 : hold(section, probe.retryAfter);
  if (probe.ok === false)
    return { ok: false, detail: probe.detail, wait };

  applyProbe(section, next, form, probe.detail);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: probe.detail, wait: 0 };
}

export async function saveResumeAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const id = resumeIdOf(String(form.get('hhResumeId') ?? '').trim());
  if (/^[A-Za-z0-9]{8,}$/.test(id) === false)
    return { ok: false, detail: 'это не ссылка на резюме', wait: 0 };

  const next = { ...await readAccount(login) };
  next.hhResumeId = id;
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: id, wait: 0 };
}

async function probeSection(section: Section, form: FormData) {
  if (section === 'telegram')
    return probeTelegram(String(form.get('telegramToken') ?? '').trim());

  return probeHh(
    String(form.get('hhAccessToken') ?? '').trim(),
    resumeIdOf(String(form.get('hhResumeId') ?? '').trim()),
  );
}

function resumeIdOf(raw: string): string {
  const found = raw.match(/\/resume\/([A-Za-z0-9]+)/);
  if (found)
    return found[1];

  return raw;
}

function applyProbe(section: Section, next: Stored, form: FormData, detail: string) {
  if (section === 'telegram') {
    next.telegramToken = String(form.get('telegramToken') ?? '').trim();
    next.telegramLabel = detail;
    return;
  }

  next.hhAccessToken = String(form.get('hhAccessToken') ?? '').trim() || next.hhAccessToken;
  next.hhResumeId = resumeIdOf(String(form.get('hhResumeId') ?? '').trim());
  next.hhLabel = detail;
}

export async function saveQueryAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const query = splitQueries(String(form.get('hhQuery') ?? '').slice(0, 600)).join('\n');
  if (query.length === 0)
    return { ok: false, detail: 'пустой запрос', wait: 0 };

  const next = { ...await readAccount(login), hhQuery: query };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: query, wait: 0 };
}

export async function suggestQueryAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const saved = await readAccount(login);
  const chain = chainOf(saved);
  if (chain.length === 0)
    return { ok: false, detail: 'нет ключа модели', wait: 0 };

  try {
    const queries = await suggestQueries(chain, saved.coverLetter || COVER_LETTER);

    return { ok: true, detail: queries.join('\n'), wait: 0 };
  }
  catch (err) {
    const why = err instanceof Error ? err.message : 'без ответа';

    return { ok: false, detail: `модель: ${why}`, wait: 0 };
  }
}

export async function saveLetterAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const letter = String(form.get('coverLetter') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  if (letter.length === 0)
    return { ok: false, detail: 'пустое письмо', wait: 0 };

  const next = { ...await readAccount(login), coverLetter: letter };
  await writeAccount(login, next);

  return { ok: true, detail: 'Сохранено', wait: 0 };
}

export async function issueExtTokenAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const next = { ...await readAccount(login), extToken: newExtToken() };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: next.extToken, wait: 0 };
}

export async function addProviderAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const provider = asProvider({
    id: String(form.get('provider') ?? ''),
    key: String(form.get('key') ?? '').trim(),
    model: String(form.get('model') ?? '').trim(),
    url: String(form.get('url') ?? '').trim(),
  });
  if (provider === null)
    return { ok: false, detail: 'не хватает ключа, модели или адреса', wait: 0 };

  const probe = await probeModel(provider);
  if (probe.ok === false)
    return { ok: false, detail: probe.detail, wait: probe.retryAfter };

  const saved = await readAccount(login);
  const chain = chainOf(saved).filter(item => item.url !== provider.url || item.model !== provider.model);
  const next = withChain(saved, [...chain, provider]);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: probe.detail, wait: 0 };
}

export async function removeProviderAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const index = Number(form.get('index'));
  const saved = await readAccount(login);
  const chain = chainOf(saved);
  if (Number.isInteger(index) === false || index < 0 || index >= chain.length)
    return { ok: false, detail: 'нет такого', wait: 0 };

  const next = withChain(saved, chain.filter((_, position) => position !== index));
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'убрал', wait: 0 };
}

export async function raiseProviderAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const index = Number(form.get('index'));
  const saved = await readAccount(login);
  const chain = chainOf(saved);
  if (Number.isInteger(index) === false || index < 1 || index >= chain.length)
    return { ok: false, detail: 'уже первый', wait: 0 };

  const reordered = [...chain];
  [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
  const next = withChain(saved, reordered);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'поднял', wait: 0 };
}

export async function unlinkAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false };

  const form = await request.formData();
  if (String(form.get('phrase') ?? '') !== 'unlink')
    return { ok: false };

  const section = sectionOf(form);
  if (section === null)
    return { ok: false };

  const next = { ...await readAccount(login) };
  clearSection(section, next);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true };
}

function clearSection(section: Section, next: Stored) {
  if (section === 'telegram') {
    next.telegramToken = '';
    next.telegramLabel = '';
    return;
  }

  if (section === 'model') {
    next.modelChain = '';
    return;
  }

  next.hhAccessToken = '';
  next.hhResumeId = '';
  next.hhLabel = '';
}

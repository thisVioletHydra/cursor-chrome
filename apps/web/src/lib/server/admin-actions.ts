import type { RequestEvent } from '@sveltejs/kit';
import type { Stored } from './secrets';

import type { Provider } from '@cursor-chrome/hh';

import { asProvider, COVER_LETTER, distillCorpus, parseRules, providerName, scoreAts, splitQueries, splitWords, suggestQueries, watchRestart } from '@cursor-chrome/hh';
import { error } from '@sveltejs/kit';
import { probeHh, probeModel, probeTelegram } from './checks';
import { chainOf, collapseChain, imitationFromFields, isCreator, newExtToken, publishSecrets, readAccount, readResume, withChain, writeAccount, writeAtsScan } from './secrets';
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

export async function saveRulesAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const hhRules = JSON.stringify(parseRules({
    stopWords: splitWords(String(form.get('stopWords') ?? '')),
    mustWords: splitWords(String(form.get('mustWords') ?? '')),
    salaryMin: salaryMinOf(String(form.get('salaryMin') ?? '')),
    blacklist: splitWords(String(form.get('blacklist') ?? '')),
  }));
  const next = { ...await readAccount(login), hhRules };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'Сохранено', wait: 0 };
}

function salaryMinOf(raw: string): number {
  const text = raw.trim();
  if (text.length === 0)
    return 0;

  const value = Number(text);

  return Number.isFinite(value) ? value : 0;
}

export async function saveCorpusAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const hhCorpus = form.get('hhCorpus') === '1' ? '1' : '';
  const next = { ...await readAccount(login), hhCorpus };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: hhCorpus === '1' ? 'Коплю тексты' : 'Выключено', wait: 0 };
}

export async function distillAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const saved = await readAccount(login);
  if (saved.hhCorpus !== '1')
    return { ok: false, detail: 'сбор выключен', wait: 0 };

  const chain = chainOf(saved);
  if (chain.length === 0)
    return { ok: false, detail: 'нет ключа модели', wait: 0 };

  try {
    const brief = await distillCorpus(chain);

    return { ok: true, detail: brief, wait: 0 };
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : 'не вышло';

    return { ok: false, detail, wait: 0 };
  }
}

const SUGGEST_LIMIT_MS = 30_000;

export async function suggestQueryAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const saved = await readAccount(login);
  const chain = chainOf(saved);
  if (chain.length === 0)
    return { ok: false, detail: 'нет ключа модели', wait: 0 };

  try {
    const picked = await limitSuggest(suggestQueries(chain, saved.coverLetter || COVER_LETTER));

    return { ok: true, detail: picked.queries.join('\n'), via: providerName(picked.provider), wait: 0 };
  }
  catch (err) {
    return { ok: false, detail: suggestDetail(err), wait: 0 };
  }
}

export async function scanAtsAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const saved = await readAccount(login);
  const chain = chainOf(saved);
  if (chain.length === 0)
    return { ok: false, detail: 'нет ключа модели', wait: 0 };

  const resume = await readResume(login);
  if (resume === null || resume.id !== saved.hhResumeId)
    return { ok: false, detail: 'текста резюме ещё нет', wait: 0 };

  try {
    const picked = await limitFor(scoreAts(chain, resume.text), 56_000);
    const via = providerName(picked.provider);
    const at = Date.now();
    await writeAtsScan(login, { score: picked.score, flags: picked.flags, via, at, letter: '', resumeAt: resume.at });

    return { ok: true, score: picked.score, flags: picked.flags, via, at, detail: '', wait: 0 };
  }
  catch (err) {
    return { ok: false, detail: suggestDetail(err), wait: 0 };
  }
}

function limitSuggest<T>(work: Promise<T>): Promise<T> {
  return limitFor(work, SUGGEST_LIMIT_MS);
}

function limitFor<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('модель не ответила, время вышло')), ms);
    work.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function suggestDetail(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (message.length === 0 || /timeout|aborted/i.test(message))
    return 'модель не ответила, время вышло';

  return message;
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

const IMITATION_FIELDS = [
  'readMin',
  'readMax',
  'distractMin',
  'distractMax',
  'teaEvery',
  'teaMin',
  'teaMax',
  'fastEvery',
  'fastMin',
  'fastMax',
] as const;

export async function saveImitationAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const key of IMITATION_FIELDS)
    fields[key] = String(form.get(key) ?? '');

  const parsed = imitationFromFields(fields);
  if (parsed.ok === false)
    return { ok: false, detail: parsed.detail, wait: 0 };

  const next = { ...await readAccount(login), imitation: parsed.pace };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'Сохранено', wait: 0 };
}

export async function setLiveAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const hhLive = form.get('hhLive') === '1' ? '1' : '';
  const next = { ...await readAccount(login), hhLive };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: hhLive === '1' ? 'Боевой режим включён' : 'Боевой режим выключен', wait: 0 };
}

export async function setHoursAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', hours: true };

  const form = await request.formData();
  const hhHours = form.get('hhHours') === '0' ? '0' : '1';
  const next = { ...await readAccount(login), hhHours };
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'Сохранено', hours: hhHours !== '0' };
}

export async function restartAdmin({ cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр' };

  await watchRestart();

  return { ok: true, detail: 'Включил' };
}

export async function importSetupAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  if (viewingGuest(cookies, login))
    return { ok: false, detail: 'это просмотр', wait: 0 };

  const form = await request.formData();
  const file = form.get('config');
  if (file instanceof File === false)
    return { ok: false, detail: 'нет файла', wait: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  }
  catch {
    return { ok: false, detail: 'это не json', wait: 0 };
  }

  const setup = parseSetup(parsed);
  if (setup === null)
    return { ok: false, detail: 'конфиг не тот', wait: 0 };

  if (setup.expiresAt < Date.now())
    return { ok: false, detail: 'конфиг протух, собери заново', wait: 0 };

  const telegram = await probeTelegram(setup.telegramToken);
  if (telegram.ok === false)
    return { ok: false, detail: telegram.detail, wait: 0 };

  const listed = setup.providers.length > 0 ? setup.providers : [setup.gemini];
  const candidates = listed.flatMap(item => {
    const provider = asProvider(item);

    return provider === null ? [] : [provider];
  });
  if (candidates.length === 0)
    return { ok: false, detail: 'в конфиге нет модели', wait: 0 };

  const accepted: Provider[] = [];
  let fail = 'модель не ответила';
  for (const provider of candidates) {
    const model = await probeModel(provider);
    if (model.ok)
      accepted.push(provider);
    else
      fail = model.detail;
  }
  if (accepted.length === 0)
    return { ok: false, detail: fail, wait: 0 };

  const resumeId = resumeIdOf(setup.hhResumeId);
  if (/^[A-Za-z0-9]{8,}$/.test(resumeId) === false)
    return { ok: false, detail: 'в конфиге кривое резюме', wait: 0 };

  const saved = await readAccount(login);
  let chain = chainOf(saved);
  for (const provider of accepted) {
    chain = chain.filter(item => item.id !== provider.id);
    chain = [...chain, provider];
  }
  chain = collapseChain(chain);
  const next = withChain({
    ...saved,
    telegramToken: setup.telegramToken,
    telegramLabel: telegram.detail,
    hhResumeId: resumeId,
    hhLabel: resumeId,
  }, chain);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: 'Перенесено', wait: 0 };
}

function parseSetup(value: unknown): { expiresAt: number; telegramToken: string; gemini: unknown; providers: unknown[]; hhResumeId: string } | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Record<string, unknown>;
  if (row.kind !== 'cursor-chrome-setup' || typeof row.expiresAt !== 'number')
    return null;

  if (typeof row.telegramToken !== 'string' || typeof row.hhResumeId !== 'string')
    return null;

  return {
    expiresAt: row.expiresAt,
    telegramToken: row.telegramToken.trim(),
    gemini: row.gemini,
    providers: Array.isArray(row.providers) ? row.providers : [],
    hhResumeId: row.hhResumeId.trim(),
  };
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
  const chain = collapseChain([
    ...chainOf(saved).filter(item => item.id !== provider.id),
    provider,
  ]);
  const next = withChain(saved, chain);
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
  next.hhClientId = '';
  next.hhClientSecret = '';
  next.hhResumeId = '';
  next.hhLabel = '';
}

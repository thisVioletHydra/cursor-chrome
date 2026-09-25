import type { RequestEvent } from '@sveltejs/kit';
import type { Stored } from './secrets';

import { error } from '@sveltejs/kit';
import { probeHh, probeMistral, probeTelegram } from './checks';
import { publishSecrets, readAccount, writeAccount } from './secrets';
import { allowedLogins, readSession } from './session';

const sections = ['telegram', 'mistral', 'hh'] as const;
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

export async function verifyAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
  const form = await request.formData();
  const section = sectionOf(form);
  if (section === null)
    return { ok: false, detail: 'раздел не тот', wait: 0 };

  const left = cooling(section);
  if (left > 0)
    return { ok: false, detail: 'подожди', wait: left };

  const saved = await readAccount(login);
  const next = { ...saved };
  const probe = await probeSection(section, form);
  const wait = probe.ok ? 0 : hold(section, probe.retryAfter);
  if (probe.ok === false)
    return { ok: false, detail: probe.detail, wait };

  applyProbe(section, next, form, probe.detail);
  await writeAccount(login, next);
  publishSecrets(login, next);

  return { ok: true, detail: probe.detail, wait: 0 };
}

async function probeSection(section: Section, form: FormData) {
  if (section === 'telegram')
    return probeTelegram(String(form.get('telegramToken') ?? '').trim());

  if (section === 'mistral')
    return probeMistral(String(form.get('mistralKey') ?? '').trim());

  return probeHh(
    String(form.get('hhAccessToken') ?? '').trim(),
    String(form.get('hhResumeId') ?? '').trim(),
  );
}

function applyProbe(section: Section, next: Stored, form: FormData, detail: string) {
  if (section === 'telegram') {
    next.telegramToken = String(form.get('telegramToken') ?? '').trim();
    next.telegramLabel = detail;
    return;
  }

  if (section === 'mistral') {
    next.mistralKey = String(form.get('mistralKey') ?? '').trim();
    next.mistralLabel = detail;
    return;
  }

  next.hhAccessToken = String(form.get('hhAccessToken') ?? '').trim();
  next.hhResumeId = String(form.get('hhResumeId') ?? '').trim();
  next.hhLabel = detail;
}

export async function unlinkAdmin({ request, cookies }: RequestEvent) {
  const login = guard(cookies);
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

  if (section === 'mistral') {
    next.mistralKey = '';
    next.mistralLabel = '';
    return;
  }

  next.hhAccessToken = '';
  next.hhResumeId = '';
  next.hhLabel = '';
}

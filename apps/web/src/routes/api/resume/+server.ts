import type { RequestHandler } from './$types';

import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount, writeResume } from '$lib/server/secrets';

const TEXT_MAX = 40_000;

export const GET: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const account = await readAccount(login);

  return json({ id: account.hhResumeId });
};

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { id?: unknown; text?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const text = plainResume(typeof body?.text === 'string' ? body.text : '');
  if (/^[A-Za-z0-9]{8,}$/.test(id) === false)
    return json({ ok: false, reason: 'не тот id' }, { status: 400 });
  if (text === null)
    return json({ ok: false, reason: 'это не текст резюме' }, { status: 400 });

  const account = await readAccount(login);
  if (account.hhResumeId !== id)
    return json({ ok: false, reason: 'это не сохранённая ссылка' }, { status: 409 });

  await writeResume(login, { id, text, at: Date.now() });

  return json({ ok: true }, { status: 201 });
};

function plainResume(raw: string): string | null {
  const text = raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_MAX);
  if (text.length < 80)
    return null;

  const head = text.slice(0, 1500);
  if (/<!doctype|<html|account-login|ddos-guard|отключите vpn|turn off vpn|disable vpn/i.test(head))
    return null;

  return text;
}

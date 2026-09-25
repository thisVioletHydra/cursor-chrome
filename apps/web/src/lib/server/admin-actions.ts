import type { RequestEvent } from '@sveltejs/kit';
import type { Secrets } from './secrets';

import { error } from '@sveltejs/kit';
import { publishSecrets, readSecrets, stageUndo, takeUndo, writeSecrets } from './secrets';
import { allowedLogins, readSession } from './session';

const fields = ['telegramToken', 'mistralKey', 'hhAccessToken', 'hhResumeId'] as const;

function guard(cookies: RequestEvent['cookies']) {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    error(401, 'нет');
}

export async function saveAdmin({ request, cookies }: RequestEvent) {
  guard(cookies);
  const form = await request.formData();
  const saved = await readSecrets();
  const next: Secrets = { ...saved };
  for (const key of fields) {
    const value = String(form.get(key) ?? '').trim();
    if (value.length > 0)
      next[key] = value;
  }

  const changed = fields.some(key => next[key] !== saved[key]);
  if (changed === false)
    return { saved: false };

  stageUndo(saved);
  await writeSecrets(next);
  publishSecrets(next);
  return { saved: true };
}

export async function undoAdmin({ cookies }: RequestEvent) {
  guard(cookies);
  const previous = takeUndo();
  if (previous === null)
    return { undone: false };

  await writeSecrets(previous);
  publishSecrets(previous);
  return { undone: true };
}

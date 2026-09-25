import type { RequestHandler } from './$types';

import { answerQuestion, asQuestion } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { readAccount } from '$lib/server/secrets';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const question = asQuestion(await request.json().catch(() => null));
  if (question === null)
    return json({ human: true, reason: 'вопрос не разобран' });

  const account = await readAccount(login);
  if (account.mistralKey.length === 0)
    return json({ human: true, reason: 'нет ключа mistral' });

  try {
    return json(await answerQuestion(account.mistralKey, question));
  }
  catch (err) {
    return json({ human: true, reason: err instanceof Error ? err.message : 'mistral не ответил' });
  }
};

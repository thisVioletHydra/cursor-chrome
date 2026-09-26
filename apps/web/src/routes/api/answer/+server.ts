import type { RequestHandler } from './$types';

import { answerQuestion, asQuestion } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { chainOf, readAccount } from '$lib/server/secrets';

export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const question = asQuestion(await request.json().catch(() => null));
  if (question === null)
    return json({ human: true, reason: 'вопрос не разобран' });

  const chain = chainOf(await readAccount(login));
  if (chain.length === 0)
    return json({ human: true, reason: 'нет ключа модели' });

  try {
    return json(await answerQuestion(chain, question));
  }
  catch (err) {
    return json({ human: true, reason: err instanceof Error ? err.message : 'модель не ответила' });
  }
};

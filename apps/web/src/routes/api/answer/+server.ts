import type { RequestHandler } from './$types';

import { answerQuestion, askChain, asQuestion, chainFromEnv, parseFacts } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';
import { chainOf, readAccount } from '$lib/server/secrets';
import { serverChainFor } from '$lib/server/demo';
import { completion, isThinBody, thinAnswer } from '$lib/server/thin/answer-api';

// Two shapes: thin { fields, context } (server decides, BYOK via x-llm-key) and the legacy single question.
// Request bodies and key headers are never logged.
export const POST: RequestHandler = async ({ request }) => {
  const login = await extLogin(request);
  if (login === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as unknown;
  if (isThinBody(body)) {
    const account = await readAccount(login);
    const env = serverChainFor(login, chainFromEnv());
    const ours = env.length > 0 ? env : chainOf(account);
    // soft transition: a client without local facts gets the account's own facts (this login only)
    const row = body as { fields: unknown; context?: { facts?: unknown } };
    const context = { ...(row.context ?? {}) };
    if (Array.isArray(context.facts) === false || context.facts.length === 0)
      context.facts = parseFacts(account.facts).rules;
    const out = await thinAnswer(request.headers, { fields: row.fields, context }, ours, {
      complete: (provider, prompt) => completion(provider, prompt, { timeoutMs: 20_000 }),
      askChain: async (chain, prompt) => (await askChain(chain, prompt, 20_000)).text,
    });

    return json(out, { headers: { 'cache-control': 'no-store' } });
  }

  const question = asQuestion(body);
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

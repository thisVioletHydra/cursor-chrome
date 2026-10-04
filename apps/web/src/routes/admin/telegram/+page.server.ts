import type { Actions, PageServerLoad } from './$types';

import { connectOwner, ownerSaved } from '@cursor-chrome/telegram';
import { error, fail } from '@sveltejs/kit';
import { unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';
import { channelName, channelProblem, channelWeek } from '$lib/server/channel-feed';
import { isCreator, readAccount, writeAccount } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

export const load: PageServerLoad = async ({ cookies, parent }) => {
  const { preview } = await parent();
  if (preview)
    return { owner: false, feed: '', channel: { posts: Promise.resolve([]) } };

  const session = readSession(cookies.get('session'));
  const login = session !== null && githubLogin(session.login) ? session.login : '';
  const feed = login === '' ? '' : (await readAccount(login)).feedChannel;

  return {
    owner: await ownerSaved(),
    feed,
    channel: { posts: feed === '' ? Promise.resolve([]) : channelWeek(feed) },
  };
};

export const actions: Actions = {
  verify: verifyAdmin,
  unlink: unlinkAdmin,
  connect: async ({ cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || githubLogin(session.login) === false)
      error(401, 'нет');

    if (isCreator(session.login) && cookies.get('preview') === 'guest')
      return fail(403, { detail: 'это просмотр' });

    const result = await connectOwner();
    if (result.ok === false)
      return fail(422, { detail: result.detail });

    return { ok: true };
  },
  feed: async ({ request, cookies }) => {
    const session = readSession(cookies.get('session'));
    if (session === null || githubLogin(session.login) === false)
      error(401, 'нет');

    if (isCreator(session.login) && cookies.get('preview') === 'guest')
      return fail(403, { detail: 'это просмотр' });

    const form = await request.formData();
    const link = String(form.get('link') ?? '');
    const problem = channelProblem(link);
    if (problem)
      return fail(400, { detail: problem });

    const name = channelName(link);
    if (name === null)
      return fail(400, { detail: 'Нужна ссылка вида t.me/имя.' });

    const posts = await channelWeek(name).catch(() => null);
    if (posts === null)
      return fail(404, { detail: 'Открытой ленты нет. Закрытую группу так не прочитать.' });

    const account = await readAccount(session.login);
    account.feedChannel = name;
    await writeAccount(session.login, account);

    return { name, posts };
  },
};

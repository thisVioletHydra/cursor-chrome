import type { LayoutServerLoad } from './$types';

import { COVER_LETTER, hiddenCount, moscowDay, PRESETS, providerName, readPassed, readQueue, readState, seenCount } from '@cursor-chrome/hh';
import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { coolLeft } from '$lib/server/admin-actions';
import { guestLinks, storedLinks } from '$lib/server/checks';
import { chainOf, collapseChain, DEFAULT_QUERY, GUEST_BALANCE, isCreator, publishSecrets, readAccount, VACANCY_RUB, withChain, writeAccount } from '$lib/server/secrets';

const when = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function statsOf(preview: boolean) {
  if (preview) {
    return {
      today: 0,
      waiting: 0,
      queued: 0,
      judged: 0,
      rows: [],
      invitations: 0,
      discards: 0,
      waitingReply: 0,
      hidden: 0,
      passed: [],
      autopilot: { auto: false, lastNote: '', runAt: 0 },
    };
  }

  const [queue, state, judged, hidden, passed] = await Promise.all([readQueue(), readState(), seenCount(), hiddenCount(), readPassed()]);
  const day = moscowDay();
  const rows = [...queue.filter(row => row.status === 'needsHuman'), ...queue.filter(row => row.status !== 'needsHuman')].slice(0, 40).map(row => ({
    id: row.id,
    company: row.company,
    title: row.title,
    url: row.url,
    status: row.status,
    when: when.format(row.doneAt ?? row.at),
  }));

  return {
    today: queue.filter(row => row.status === 'sent' && moscowDay(new Date(row.doneAt ?? row.at)) === day).length,
    waiting: queue.filter(row => row.status === 'needsHuman').length,
    queued: queue.filter(row => row.status === 'pending').length,
    judged,
    rows,
    invitations: queue.filter(row => row.outcome === 'invitation').length,
    discards: queue.filter(row => row.outcome === 'discard').length,
    waitingReply: queue.filter(row => row.outcome === 'response').length,
    hidden,
    passed: passed.map(row => ({
      id: row.id,
      company: row.company,
      title: row.title,
      url: `https://hh.ru/vacancy/${row.id}`,
      reason: row.reason,
      when: when.format(row.at),
    })),
    autopilot: { auto: state.auto, lastNote: state.lastNote, runAt: state.auto ? state.runAt : 0 },
  };
}
import { allowedLogins, readSession } from '$lib/server/session';

export const load: LayoutServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    redirect(303, '/');

  const creator = isCreator(session.login);
  const preview = creator && cookies.get('preview') === 'guest';
  const account = await readAccount(session.login);
  if (preview === false) {
    const raw = chainOf(account);
    const collapsed = collapseChain(raw);
    if (JSON.stringify(raw) !== JSON.stringify(collapsed)) {
      const next = withChain(account, collapsed);
      await writeAccount(session.login, next);
      publishSecrets(session.login, next);
      account.modelChain = next.modelChain;
    }
  }
  const links = preview ? guestLinks() : await storedLinks(session.login);
  const telegram = links.find(item => item.name === 'Телега');
  return {
    login: preview ? 'гость' : session.login,
    preview,
    canPreview: creator,
    links,
    polling: preview ? false : telegramOn(),
    billing: {
      infinite: preview ? false : creator,
      balance: preview ? GUEST_BALANCE : account.balance,
      vacancyRub: VACANCY_RUB,
      history: creator && preview === false ? account.history.map(row => ({
        company: row.company,
        url: row.url,
        rub: row.rub,
        when: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(row.at),
      })) : [],
    },
    locks: {
      telegram: coolLeft('telegram'),
      hh: coolLeft('hh'),
    },
    providers: preview ? [] : chainOf(account).map(provider => ({
      id: provider.id,
      name: providerName(provider),
      model: provider.model,
      host: new URL(provider.url).host,
      keyTail: provider.key.slice(-4),
    })),
    presets: PRESETS.map(preset => ({ id: preset.id, name: preset.name, model: preset.model, keysUrl: preset.keysUrl, free: preset.free })),
    resumeId: preview ? '' : account.hhResumeId,
    hhQuery: preview ? '' : (account.hhQuery || DEFAULT_QUERY),
    hasExtToken: preview ? false : account.extToken.length > 0,
    extToken: preview ? '' : account.extToken,
    coverLetter: preview ? '' : (account.coverLetter || COVER_LETTER),
    ready: {
      telegram: preview ? false : telegram?.ok === true,
      model: preview ? false : chainOf(account).length > 0,
      resume: preview ? false : account.hhResumeId.length > 0,
      queries: preview ? false : account.hhQuery.trim().length > 0,
      extension: preview ? false : account.extToken.length > 0,
      live: preview ? false : account.hhLive === '1',
    },
    stats: await statsOf(preview),
  };
};

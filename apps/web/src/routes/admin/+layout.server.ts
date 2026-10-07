import type { LayoutServerLoad } from './$types';

import { COVER_LETTER, hiddenCount, parkStaleWaiters, passedCount, PRESETS, providerName, readMemory, readPassed, readQueue, readState, seenCount } from '@cursor-chrome/hh';
import { boardFrom } from '$lib/server/board';
import { telegramOn } from '@cursor-chrome/telegram';
import { redirect } from '@sveltejs/kit';
import { coolLeft, pruneShelvedWaiters } from '$lib/server/admin-actions';
import { guestLinks, storedLinks } from '$lib/server/checks';
import { chainOf, collapseChain, DEFAULT_QUERY, ensureAccount, GUEST_BALANCE, isCreator, publishSecrets, VACANCY_RUB, withChain, writeAccount } from '$lib/server/secrets';
import { githubLogin, readSession } from '$lib/server/session';

function emptyStats() {
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
    accepted: 0,
    stale: 0,
    passedTotal: 0,
    passed: [],
    autopilot: { auto: false, lastNote: '', runAt: 0 },
  };
}

function guestShell() {
  return {
    login: 'гость',
    preview: true,
    canPreview: true,
    links: guestLinks(),
    polling: false,
    billing: {
      infinite: false,
      balance: GUEST_BALANCE,
      vacancyRub: VACANCY_RUB,
      history: [],
    },
    locks: { telegram: 0, hh: 0 },
    providers: [],
    presets: PRESETS.map(preset => ({ id: preset.id, name: preset.name, model: preset.model, keysUrl: preset.keysUrl, free: preset.free })),
    resumeId: '',
    hhQuery: '',
    hasExtToken: false,
    extToken: '',
    coverLetter: '',
    ready: {
      telegram: false,
      model: false,
      resume: false,
      queries: false,
      extension: false,
      live: false,
    },
    stats: emptyStats(),
  };
}

async function statsOf(preview: boolean) {
  if (preview)
    return emptyStats();

  await parkStaleWaiters();
  const [loaded, state, judged, hidden, passed, passedTotal, memory] = await Promise.all([readQueue(), readState(), seenCount(), hiddenCount(), readPassed(), passedCount(), readMemory()]);
  const queue = await pruneShelvedWaiters(loaded);
  const board = boardFrom(queue, passed);

  return {
    today: memory.sent,
    queued: queue.filter(row => row.status === 'pending').length,
    judged,
    invitations: queue.filter(row => row.outcome === 'invitation').length,
    discards: queue.filter(row => row.outcome === 'discard').length,
    waitingReply: queue.filter(row => row.outcome === 'response').length,
    hidden,
    passedTotal,
    ...board,
    autopilot: { auto: state.auto, lastNote: state.lastNote, runAt: state.auto ? state.runAt : 0 },
  };
}

export const load: LayoutServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || githubLogin(session.login) === false)
    redirect(303, '/');

  const creator = isCreator(session.login);
  const preview = creator && cookies.get('preview') === 'guest';
  if (preview)
    return guestShell();

  const account = await ensureAccount(session.login);
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

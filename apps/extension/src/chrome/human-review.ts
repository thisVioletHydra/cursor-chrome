import { appendApply, isJunkApply, listApplies, todayCount, waitingHuman, type ApplyRecord } from './apply-log';
import { getWorkerTabId, handoffWorkerToHuman, isHhUrl, openHhDetached } from './worker-tab';

export async function isHhWorkerTab(tabId?: number): Promise<{ worker: boolean }> {
  const workerId = await getWorkerTabId();

  return { worker: typeof tabId === 'number' && tabId === workerId };
}

export async function handleNeedsHuman(
  message: Record<string, unknown>,
  senderTabId?: number,
): Promise<unknown> {
  const { worker } = await isHhWorkerTab(senderTabId);
  const url = String(message.url || '');
  const log = await logDetachedReview({
    url,
    title: String(message.title || ''),
    company: String(message.company || ''),
    vacancyId: String(message.vacancyId || ''),
    hints: message.hints,
  });
  if (worker && url.length > 0)
    await handoffWorkerToHuman(url);

  return {
    ok: true,
    role: worker ? 'worker' : 'review',
    today: await todayCount(),
    waiting: waitingHuman(log).length,
  };
}

export async function detachAndLog(
  url: string,
  params: Record<string, unknown> = {},
): Promise<{ id?: number; url: string; detached: true }> {
  const opened = await openHhDetached(url);
  const tab = typeof opened.id === 'number'
    ? await chrome.tabs.get(opened.id).catch(() => null)
    : null;
  await logDetachedReview({
    url: opened.url || url,
    title: String(params.title || ''),
    company: String(params.company || ''),
    vacancyId: String(params.vacancyId || ''),
    hints: params.hints ?? params.hint ?? params.reason,
    tabTitle: tab?.title || '',
  });

  return opened;
}

export async function backfillUnpinnedReviews(): Promise<void> {
  const workerId = await getWorkerTabId();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || tab.pinned === true || tab.id === workerId)
      continue;

    const url = tab.url || tab.pendingUrl || '';
    if (isHhUrl(url) === false)
      continue;

    const vacancyId = vacancyIdOf(url);
    if (vacancyId.length === 0)
      continue;

    await logDetachedReview({ url, vacancyId, tabTitle: tab.title || '' });
  }
}

export async function logDetachedReview(meta: {
  url: string;
  title?: string;
  company?: string;
  vacancyId?: string;
  hints?: unknown;
  tabTitle?: string;
}): Promise<ApplyRecord[]> {
  const vacancyId = String(meta.vacancyId || '') || vacancyIdOf(meta.url);
  const parsed = parseTabTitle(meta.tabTitle || '', String(meta.title || ''), String(meta.company || ''));
  const hints = asHints(meta.hints);
  const title = parsed.title.length > 0 && isJunkApply({ title: parsed.title, company: '' }) === false
    ? parsed.title
    : vacancyId;
  const company = parsed.company.length > 0 && isJunkApply({ title: 'ok', company: parsed.company }) === false
    ? parsed.company
    : '';
  if (title.length === 0 && company.length === 0)
    return listApplies();

  return appendApply({
    title: title || vacancyId || 'вакансия',
    company,
    url: meta.url,
    vacancyId,
    sentAt: Date.now(),
    status: 'needsHuman',
    hints: hints.length > 0 ? hints : ['нужен человек'],
  });
}

function vacancyIdOf(url: string): string {
  try {
    const parsed = new URL(url);

    return parsed.pathname.match(/\/vacancy\/(\d+)/)?.[1]
      || parsed.searchParams.get('vacancyId')
      || '';
  }
  catch {
    return '';
  }
}

function parseTabTitle(tabTitle: string, title: string, company: string): { title: string; company: string } {
  const given = {
    title: title.trim(),
    company: company.trim(),
  };
  if (given.title.length > 0 && given.company.length > 0
    && isJunkApply({ title: given.title, company: '' }) === false
    && isJunkApply({ title: 'ok', company: given.company }) === false)
    return given;

  if (given.title.length > 0 && isJunkApply({ title: given.title, company: '' }) === false) {
    return {
      title: given.title,
      company: given.company.length > 0 && isJunkApply({ title: 'ok', company: given.company })
        ? ''
        : given.company,
    };
  }

  const cleaned = tabTitle
    .replace(/\s+на hh\.ru.*$/i, '')
    .replace(/\s+[—–-]\s+(hh\.ru|HeadHunter).*$/i, '')
    .replace(/\s+[—–-]\s+работа\b.*$/i, '')
    .trim();
  if (cleaned.length === 0 || isJunkApply({ title: cleaned, company: '' }))
    return { title: given.title, company: given.company };

  const parts = cleaned.split(/\s+в\s+/);
  if (parts.length >= 2 && parts[0]) {
    const fromTab = {
      title: parts[0].trim(),
      company: parts.slice(1).join(' в ').replace(/[,:].*$/, '').trim(),
    };
    if (isJunkApply({ title: fromTab.title, company: '' })
      || (fromTab.company.length > 0 && isJunkApply({ title: 'ok', company: fromTab.company })))
      return { title: given.title, company: given.company };

    return {
      title: given.title || fromTab.title,
      company: given.company || fromTab.company,
    };
  }

  if (isJunkApply({ title: cleaned, company: '' })
    || (given.company.length > 0 && isJunkApply({ title: 'ok', company: given.company })))
    return { title: given.title, company: given.company };

  return { title: given.title || cleaned, company: given.company };
}

function asHints(value: unknown): string[] {
  if (typeof value === 'string' && value.trim().length > 0)
    return [value.trim()];

  if (Array.isArray(value) === false)
    return [];

  return value.map(item => String(item)).filter(text => text.length > 0).slice(0, 8);
}

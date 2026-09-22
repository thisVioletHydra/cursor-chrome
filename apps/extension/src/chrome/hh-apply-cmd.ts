import { handleNeedsHuman } from './human-review';
import { ensureContent, requireTabId, workerTopMessage } from './inject';
import { getWorkerTabId, requireWorkerTab, waitTab } from './worker-tab';

type ApplyReply = {
  ok?: boolean;
  status?: string;
  reason?: string;
  title?: string;
  company?: string;
  url?: string;
  vacancyId?: string;
  hints?: unknown;
  navigateTo?: string;
};

export async function runHhApply(): Promise<unknown> {
  try {
    return finishApply(await followNavigation(await workerTopMessage('run-apply')));
  }
  catch {
    const tab = await requireWorkerTab();
    await waitTab(requireTabId(tab), 15_000);
    await ensureContent(tab);

    return finishApply(await workerTopMessage('run-apply', { resume: true }));
  }
}

async function followNavigation(raw: unknown): Promise<unknown> {
  const rec = asReply(raw);
  const to = rec.navigateTo || '';
  if (to.length === 0)
    return raw;

  const tab = await requireWorkerTab();
  const tabId = requireTabId(tab);
  const wait = waitTab(tabId, 15_000);
  await chrome.tabs.update(tabId, { url: to, active: false });
  await wait;

  return workerTopMessage('run-apply', { resume: true });
}

async function finishApply(raw: unknown): Promise<unknown> {
  const result = asReply(raw);
  if (result.status !== 'needsHuman')
    return result;

  const workerId = await getWorkerTabId();
  await handleNeedsHuman(result, workerId ?? undefined);

  return result;
}

function asReply(raw: unknown): ApplyReply {
  if (!raw || typeof raw !== 'object')
    return { ok: false, status: 'skip', reason: 'нет ответа от страницы' };

  const rec = raw as Record<string, unknown>;
  const status = rec.status === 'sent' || rec.status === 'needsHuman' || rec.status === 'skip'
    ? rec.status
    : 'skip';

  return {
    ok: rec.ok === true,
    status,
    reason: String(rec.reason || ''),
    title: String(rec.title || ''),
    company: String(rec.company || ''),
    url: String(rec.url || ''),
    vacancyId: String(rec.vacancyId || ''),
    hints: rec.hints,
    navigateTo: String(rec.navigateTo || ''),
  };
}

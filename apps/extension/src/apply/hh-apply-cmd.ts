import { handleNeedsHuman } from './human-review';
import { tabShowsCaptcha } from '../tab/hh-captcha';
import { ensureContent, requireTabId, workerTopMessage } from '../link/inject';
import { tellPage } from '../pilot/page-log';
import { waitMark, waitPulse } from '../pilot/wait-pulse';
import { getWorkerTabId, requireWorkerTab, waitTab } from '../tab/worker-tab';
import { browser } from '../browser-host';

const APPLY_CAP_MS = 3 * 60_000;

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
  const before = await workerHref();
  const beat = applyBeat();
  let stuck = false;
  const cap = applyCap(() => {
    stuck = true;
  });
  try {
    return await Promise.race([applyBody(before, () => stuck), cap.promise]);
  }
  finally {
    cap.cancel();
    clearInterval(beat);
  }
}

async function applyBody(before: string, stuck: () => boolean): Promise<unknown> {
  try {
    return finishApply(await followNavigation(await workerTopMessage('run-apply')));
  }
  catch {
    if (stuck())
      return { ok: false, status: 'skip', reason: 'форма отклика зависла' };

    const tab = await requireWorkerTab();
    await waitTab(requireTabId(tab), 15_000);
    await ensureContent(tab);
    const again = await finishApply(await workerTopMessage('run-apply', { resume: true }));
    const after = await workerHref();
    if (before !== after && missedClick(again))
      return { ...asReply(again), ok: false, status: 'skip', reason: 'нет подтверждения отправки' };

    return again;
  }
}

function applyCap(mark: () => void): { promise: Promise<ApplyReply>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<ApplyReply>((resolve) => {
    timer = setTimeout(() => {
      mark();
      void stopStuckApply().then(() => resolve(stuckApply()), () => resolve(stuckApply()));
    }, APPLY_CAP_MS);
  });

  return {
    promise,
    cancel: () => {
      if (timer !== undefined)
        clearTimeout(timer);
    },
  };
}

function stuckApply(): ApplyReply {
  return { ok: false, status: 'skip', reason: 'форма отклика зависла' };
}

async function stopStuckApply(): Promise<void> {
  await tellPage('мимо, форма отклика зависла');
}

function applyBeat(): ReturnType<typeof setInterval> {
  const started = Date.now();

  return setInterval(() => {
    const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
    void tellPage(waitPulse(waitMark({
      id: 'apply.form',
      human: 'жду форму отклика',
      budget: null,
      next: 'apply.fill',
      hold: true,
    }), sec));
  }, 15_000);
}

async function workerHref(): Promise<string> {
  const tab = await requireWorkerTab().catch(() => null);

  return tab?.url || tab?.pendingUrl || '';
}

function missedClick(raw: unknown): boolean {
  const reason = asReply(raw).reason;

  return reason === 'нет кнопки Откликнуться'
    || reason === 'нет кнопки отправки'
    || reason === 'форма отклика не открылась'
    || reason === 'не страница вакансии';
}

async function followNavigation(raw: unknown): Promise<unknown> {
  const rec = asReply(raw);
  const to = rec.navigateTo || '';
  if (to.length === 0)
    return raw;

  const tab = await requireWorkerTab();
  const tabId = requireTabId(tab);
  if (await tabShowsCaptcha(tabId))
    return { ok: false, status: 'skip', reason: 'капча' };

  const wait = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, { url: to, active: false });
  await wait;

  return workerTopMessage('run-apply', { resume: true });
}

async function finishApply(raw: unknown): Promise<unknown> {
  const result = asReply(raw);
  if (captchaReply(result))
    return result;

  if (result.status !== 'needsHuman')
    return result;

  const workerId = await getWorkerTabId();
  await handleNeedsHuman(result, workerId ?? undefined);

  return result;
}

function captchaReply(raw: ApplyReply): boolean {
  if (raw.reason === 'капча')
    return true;

  return Array.isArray(raw.hints) && raw.hints.some(item => item === 'капча');
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

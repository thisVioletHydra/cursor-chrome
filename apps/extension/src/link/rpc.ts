import { askCloud } from '../apply/answer';
import { appendApply, clearWaiting, dropWaiting, getSyncKey, getSyncUrl, listApplies, setSyncKey, setSyncUrl, sweepDismissedWaiting, todayCount, waitingHuman } from '../diary/apply-log';
import { getFlags, setFlags } from '../pilot/flags';
import { backfillUnpinnedReviews, handleNeedsHuman, isHhWorkerTab } from '../apply/human-review';
import { syncNegotiations } from '../apply/negotiations';
import { bindPilotSettle, clearStuckHang, forgetStuckHang, liveLines, stallStep, stalling, tellPage } from '../pilot/page-log';
import { reconcilePilot } from '../pilot/pilot-heal';
import { clearPilotLink, clearPilotPending, notePilotLink, setPilotPending, takeServerPush } from '../pilot/pilot-link';
import { applyPilot } from '../pilot/pilot-apply';
import { clearPilotStop, markPilotStop } from '../pilot/pilot-stop';
import { pushPilot, retryPilotPush } from '../pilot/pilot-switch';
import { clearFormHold } from '../apply/form-hold';
import { forgetHangReport, guardCaptcha, queueBusy, readPausedUntil, readQueueReport, runQueue } from '../apply/queue-run';
import { pullSavedResume } from '../apply/resume-pull';
import { checkWorker, listJobTabs, openHhBackground, openOnHhTab, pinWorker } from '../tab/worker-tab';
import { ensurePinnedHh, openPinnedWorker } from '../tab/worker-open';

type Reply = (value?: unknown) => void;
type Sender = chrome.runtime.MessageSender;

function replyJob(reply: Reply, job: Promise<unknown>): void {
  void job.then(reply).catch((error) => {
    reply({ error: error instanceof Error ? error.message : String(error) });
  });
}

async function applyLog(message: Record<string, unknown>): Promise<unknown> {
  const log = await appendApply({
    title: String(message.title || ''),
    company: String(message.company || ''),
    url: String(message.url || ''),
    vacancyId: String(message.vacancyId || ''),
    sentAt: Date.now(),
  });

  return { ok: true, today: await todayCount(), total: log.length };
}

async function applyHistory(): Promise<unknown> {
  await backfillUnpinnedReviews();
  await sweepDismissedWaiting();
  const log = await listApplies();

  return { log, today: await todayCount(), waiting: waitingHuman(log) };
}

async function dropWaitingMessage(message: Record<string, unknown>): Promise<unknown> {
  const sentAt = typeof message.sentAt === 'number' ? message.sentAt : Number(message.sentAt);
  await dropWaiting({
    vacancyId: String(message.vacancyId || ''),
    sentAt: Number.isFinite(sentAt) ? sentAt : 0,
    title: String(message.title || ''),
    company: String(message.company || ''),
  });

  return { ok: true };
}

async function clearWaitingMessage(): Promise<unknown> {
  await clearWaiting();

  return { ok: true };
}

async function readSyncUrl(): Promise<unknown> {
  const [url, key] = await Promise.all([getSyncUrl(), getSyncKey()]);

  return { url, hasKey: key.length > 0 };
}

async function writeSyncUrl(url: string, key: string): Promise<unknown> {
  await setSyncUrl(url);
  if (key.length > 0)
    await setSyncKey(key);

  return { ok: true };
}

export const rpc: Record<string, (message: Record<string, unknown>, reply: Reply, sender?: Sender) => boolean> = {
  'list-tabs': (_message, reply) => {
    replyJob(reply, listJobTabs());

    return true;
  },
  'pin-tab': (message, reply) => {
    const tabId = Number(message.tabId);
    if (Number.isInteger(tabId) === false) {
      reply({ ok: false, reason: 'нет tabId' });

      return true;
    }

    replyJob(reply, pinWorker(tabId));

    return true;
  },
  'check-worker': (_message, reply) => {
    replyJob(reply, checkWorker());

    return true;
  },
  'open-hh': (_message, reply) => {
    replyJob(reply, openHhBackground());

    return true;
  },
  'hh-same-tab': (message, reply) => {
    replyJob(reply, openOnHhTab(String(message.url || '')));

    return true;
  },
  'ensure-hh': (_message, reply) => {
    replyJob(reply, ensurePinnedHh());

    return true;
  },
  'open-worker-url': (message, reply) => {
    replyJob(reply, openPinnedWorker(String(message.url || '')));

    return true;
  },
  'apply-log': (message, reply) => {
    replyJob(reply, applyLog(message));

    return true;
  },
  'apply-needs-human': (message, reply, sender) => {
    replyJob(reply, handleNeedsHuman(message, sender?.tab?.id));

    return true;
  },
  'is-hh-worker': (_message, reply, sender) => {
    replyJob(reply, isHhWorkerTab(sender?.tab?.id));

    return true;
  },
  'apply-history': (_message, reply) => {
    replyJob(reply, applyHistory());

    return true;
  },
  'drop-waiting': (message, reply) => {
    replyJob(reply, dropWaitingMessage(message));

    return true;
  },
  'clear-waiting': (_message, reply) => {
    replyJob(reply, clearWaitingMessage());

    return true;
  },
  'get-sync-url': (_message, reply) => {
    replyJob(reply, readSyncUrl());

    return true;
  },
  'set-sync-url': (message, reply) => {
    replyJob(reply, writeSyncUrl(String(message.url || ''), String(message.key || '')));

    return true;
  },
  'run-queue': (_message, reply) => {
    if (queueBusy() === false)
      clearStuckHang();

    replyJob(reply, runQueue());

    return true;
  },
  'pull-resume': (_message, reply, sender) => {
    replyJob(reply, pullSavedResume(sender?.tab?.url || ''));

    return true;
  },
  'page-log': (message, reply) => {
    const line = typeof message.line === 'string' ? message.line : '';
    replyJob(reply, tellPage(line).then(() => ({ ok: true })));

    return true;
  },
  'page-log-get': (_message, reply) => {
    reply({ lines: liveLines(), stall: stalling(), step: stallStep() });

    return true;
  },
  'forget-hang': (_message, reply) => {
    replyJob(reply, forgetHangReport());

    return true;
  },
  'sync-negotiations': (_message, reply) => {
    replyJob(reply, syncNegotiations());

    return true;
  },
  'get-paused': (_message, reply) => {
    replyJob(reply, readPausedUntil().then(pausedUntil => ({ pausedUntil })));

    return true;
  },
  'get-queue-report': (_message, reply) => {
    replyJob(reply, readQueueReport());

    return true;
  },
  'answer-question': (message, reply) => {
    const { type: _type, ...question } = message;
    replyJob(reply, askCloud(question));

    return true;
  },
  'get-flags': (_message, reply) => {
    replyJob(reply, reconcilePilot());

    return true;
  },
  'pilot-touch': (message, reply) => {
    const action = touchAction(message.action);
    if (action === null)
      return false;

    replyJob(reply, applyPilot({ type: 'touch', action }));

    return true;
  },
  'set-flags': (message, reply) => {
    const patch: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean; autoQueue?: boolean } = {};
    if ('hideJunk' in message)
      patch.hideJunk = message.hideJunk === true;

    if ('keepSession' in message)
      patch.keepSession = message.keepSession === true;

    if ('showPop' in message)
      patch.showPop = message.showPop === true;

    if ('showMachine' in message)
      patch.showMachine = message.showMachine === true;

    if ('autoQueue' in message)
      patch.autoQueue = message.autoQueue === true;

    replyJob(reply, writeFlags(patch));

    return true;
  },
};

function touchAction(value: unknown): 'popup' | 'pin' | 'wake' | 'restore' | 'discarded' | 'tab' | null {
  if (value === 'popup' || value === 'pin' || value === 'wake')
    return value;

  if (value === 'restore' || value === 'discarded' || value === 'tab')
    return value;

  return null;
}

async function flagsAfter(
  patch: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean; autoQueue?: boolean },
  on: boolean,
): Promise<{ hideJunk: boolean; keepSession: boolean; showPop: boolean; showMachine: boolean; autoQueue: boolean }> {
  const rest: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean } = {};
  if ('hideJunk' in patch)
    rest.hideJunk = patch.hideJunk;

  if ('keepSession' in patch)
    rest.keepSession = patch.keepSession;

  if ('showPop' in patch)
    rest.showPop = patch.showPop;

  if ('showMachine' in patch)
    rest.showMachine = patch.showMachine;

  if ('hideJunk' in rest || 'keepSession' in rest || 'showPop' in rest || 'showMachine' in rest)
    await setFlags(rest);

  return { ...await getFlags(), autoQueue: on };
}

async function writeFlags(patch: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean; autoQueue?: boolean }): Promise<unknown> {
  if (patch.autoQueue === true)
    return enablePilot(patch);

  if (patch.autoQueue === false)
    return disablePilot(patch);

  return setFlags(patch);
}

async function enablePilot(patch: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean; autoQueue?: boolean }): Promise<unknown> {
  if (await guardCaptcha(true)) {
    await clearPilotPending();
    await clearPilotLink();

    return { error: 'капча, позови человека', autoQueue: false };
  }

  await clearPilotStop();
  await clearFormHold();
  await setPilotPending('on');
  const decided = await applyPilot({ type: 'enable' });
  const next = await flagsAfter(patch, decided.on);
  if (next.autoQueue === true) {
    const opened = await ensurePinnedHh();
    if (opened.ok === false)
      return { ...next, error: opened.reason || 'не удалось открыть hh' };
  }

  await forgetStuckHang();
  const pushed = await pushPilot(true);
  if (pushed.ok) {
    await clearPilotPending();
    await clearPilotLink();

    return next;
  }

  await notePilotLink(pushed.error);

  return { ...next, error: pushed.error };
}

async function disablePilot(patch: { hideJunk?: boolean; keepSession?: boolean; showPop?: boolean; showMachine?: boolean; autoQueue?: boolean }): Promise<unknown> {
  await setPilotPending('off');
  await markPilotStop();
  const decided = await applyPilot({ type: 'stop', reason: 'user' });
  const next = await flagsAfter(patch, decided.on);

  await clearPilotLink();
  await forgetStuckHang();
  const pushed = await pushPilot(false);
  if (pushed.ok)
    await clearPilotPending();

  return next;
}

bindPilotSettle(async () => {
  const confirmed = await retryPilotPush(takeServerPush());
  if (confirmed === false)
    return;

  const flags = await getFlags();
  if (flags.autoQueue === true)
    await runQueue();
});

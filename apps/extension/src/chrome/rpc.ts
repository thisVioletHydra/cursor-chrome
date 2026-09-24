import { appendApply, getSyncUrl, listApplies, setSyncUrl, todayCount, waitingHuman } from './apply-log';
import { getFlags, setFlags } from './flags';
import { backfillUnpinnedReviews, handleNeedsHuman, isHhWorkerTab } from './human-review';
import { checkWorker, listJobTabs, openHhBackground, pinWorker } from './worker-tab';
import { openPinnedWorker } from './worker-open';

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
  const log = await listApplies();

  return { log, today: await todayCount(), waiting: waitingHuman(log) };
}

async function readSyncUrl(): Promise<unknown> {
  const url = await getSyncUrl();

  return { url };
}

async function writeSyncUrl(url: string): Promise<unknown> {
  await setSyncUrl(url);

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
  'get-sync-url': (_message, reply) => {
    replyJob(reply, readSyncUrl());

    return true;
  },
  'set-sync-url': (message, reply) => {
    replyJob(reply, writeSyncUrl(String(message.url || '')));

    return true;
  },
  'get-flags': (_message, reply) => {
    replyJob(reply, getFlags());

    return true;
  },
  'set-flags': (message, reply) => {
    const patch: { hideJunk?: boolean; keepSession?: boolean } = {};
    if ('hideJunk' in message)
      patch.hideJunk = message.hideJunk === true;

    if ('keepSession' in message)
      patch.keepSession = message.keepSession === true;

    replyJob(reply, setFlags(patch));

    return true;
  },
};

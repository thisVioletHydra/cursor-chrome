import { appendApply, getSyncUrl, listApplies, setSyncUrl, todayCount } from './apply-log';
import { getFlags, setFlags } from './flags';
import { checkWorker, listJobTabs, openHhBackground, pinWorker } from './worker-tab';

type Reply = (value?: unknown) => void;

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
  const [log, today] = await Promise.all([listApplies(), todayCount()]);

  return { log, today };
}

async function readSyncUrl(): Promise<unknown> {
  const url = await getSyncUrl();

  return { url };
}

async function writeSyncUrl(url: string): Promise<unknown> {
  await setSyncUrl(url);

  return { ok: true };
}

export const rpc: Record<string, (message: Record<string, unknown>, reply: Reply) => boolean> = {
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
  'apply-log': (message, reply) => {
    replyJob(reply, applyLog(message));

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
    replyJob(reply, setFlags({ hideJunk: message.hideJunk === true }));

    return true;
  },
};

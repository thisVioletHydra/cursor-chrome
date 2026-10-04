import type { Buckets, Slot } from '../mix/mix.ts';
import type { Memory } from '../diary/memory.ts';
import type { Provider } from '../model/model.ts';
import type { Model, Report, Vacancy } from './rules.ts';
import type { Rules } from './score.ts';

import { sendApply } from './apply.ts';
import { keepVacancy } from '../model/corpus.ts';
import { fillKnownForm } from './form.ts';
import { judge, packReport } from './judge.ts';
import { searchVacancies } from './hh-api.ts';
import { LOOK_PER_START, MODEL_PER_START, QUEUE_TARGET } from '../limits.ts';
import { dropPassed, knownAmong, notePassed, readMemory, remember } from '../diary/memory.ts';
import { FRONT_TAKE, hasSlot, roleJunk, stepSlot, takeSlot, taste } from '../mix/mix.ts';
import { modelFromEnv, modelsDown } from '../model/model.ts';
import { pendingCount } from '../queue/queue.ts';
import { hardSkip } from './rules.ts';
import { byScore, ruleSkip, rulesFromEnv, scoreOf } from './score.ts';

export type ScanRun = { reports: Report[]; already: number };

export type ScanOpts = {
  query: string;
  dry: boolean;
  live: boolean;
  model?: Model | null;
  chain?: Provider[];
  rules?: Rules;
  load?: (query: string, limit: number) => Promise<Vacancy[]>;
  signal?: AbortSignal;
};

export async function scan(opts: ScanOpts): Promise<ScanRun> {
  const load = opts.load ?? searchVacancies;
  const rules = opts.rules ?? rulesFromEnv();
  const model = opts.model === undefined ? modelFromEnv() : opts.model;
  const chain = opts.chain;
  const dry = opts.dry || opts.live === false;
  const memory = opts.live ? await readMemory() : null;
  let room = await queueRoomOrOpen(memory);
  let modelUsed = 0;
  const reports: Report[] = [];

  const found = await load(opts.query, LOOK_PER_START);
  const known = new Set(memory === null ? [] : await knownAmong(found.map(vacancy => vacancy.id)));
  const already = found.filter(vacancy => known.has(vacancy.id)).length;
  const fresh = found.filter(vacancy => known.has(vacancy.id) === false).sort(byScore(rules));
  const junk = fresh.filter(vacancy => roleJunk(vacancy.title));
  const open = fresh.filter(vacancy => roleJunk(vacancy.title) === false);
  const buckets: Buckets<Vacancy> = {
    front: open.filter(vacancy => taste(vacancy.title, vacancy.foundBy ?? '') === 'front'),
    less: open.filter(vacancy => taste(vacancy.title, vacancy.foundBy ?? '') === 'less'),
    rest: open.filter(vacancy => taste(vacancy.title, vacancy.foundBy ?? '') === 'out'),
  };

  for (const vacancy of junk) {
    if (opts.signal?.aborted)
      break;

    if (memory !== null) {
      await remember([vacancy.id]);
      await notePassed([{ id: vacancy.id, reason: 'не та роль', company: vacancy.company, title: vacancy.title }]);
    }

    reports.push(packReport(vacancy, 'skip', 'не та роль', dry));
  }

  let prefer: Slot = 'front';
  let left = FRONT_TAKE;

  while (opts.signal?.aborted !== true && hasSlot(buckets)) {
    if (room <= 0) {
      const held = takeSlot(buckets, prefer);
      if (held !== undefined) {
        const why = memory !== null && memory.sent >= memory.cap ? 'потолок на сегодня' : 'очередь полная';
        reports.push(packReport(held, 'human', why, dry));
      }

      break;
    }

    const vacancy = takeSlot(buckets, prefer);
    if (vacancy === undefined)
      break;

    const ruled = ruleSkip(vacancy, rules);
    if (hardSkip(vacancy) === null && ruled === null)
      await keepVacancy(vacancy);
    const report = ruled
      ? packReport(vacancy, 'skip', ruled, dry)
      : await judge(vacancy, {
          dry,
          model,
          modelLeft: () => modelUsed < MODEL_PER_START,
          takeModel: () => {
            modelUsed += 1;
          },
        });

    if (modelsDown(report.reason)) {
      reports.push(report);
      break;
    }

    const final = opts.live && report.verdict === 'apply'
      ? await finish(vacancy, report, scoreOf(vacancy, rules), chain)
      : report;

    if (memory !== null) {
      await remember([vacancy.id]);
      if (final.verdict === 'apply')
        await dropPassed([vacancy.id]);
      else if (final.verdict === 'skip' || modelGap(final.reason) === false)
        await notePassed([{ id: vacancy.id, reason: final.reason, company: vacancy.company, title: vacancy.title }]);
    }

    if (final.verdict === 'apply') {
      if (opts.live)
        room -= 1;

      const step = stepSlot(prefer, left);
      prefer = step.prefer;
      left = step.left;
    }

    reports.push(final);
  }

  return { reports, already };
}

function modelGap(reason: string): boolean {
  return reason === 'модель не смотрела' || reason === 'модель не ответила' || reason.startsWith('все модели недоступны');
}

async function queueRoomOrOpen(memory: Memory | null): Promise<number> {
  if (memory === null)
    return Number.POSITIVE_INFINITY;

  return queueRoom(memory);
}

async function queueRoom(memory: Memory): Promise<number> {
  const queued = await pendingCount();

  return Math.min(QUEUE_TARGET - queued, memory.cap - memory.sent - queued);
}

async function finish(vacancy: Vacancy, report: Report, score: number, chain: Provider[] | undefined): Promise<Report> {
  if (vacancy.formUrl.length > 0) {
    const form = await fillKnownForm(vacancy.formUrl, chain);
    if (form === 'human')
      return packReport(vacancy, 'human', 'форма', false);
  }

  const sent = await sendApply(vacancy, report.reason, score);
  if (sent === 'again')
    return packReport(vacancy, 'skip', 'уже в очереди', false);

  return packReport(vacancy, 'apply', report.reason, false);
}

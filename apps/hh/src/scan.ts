import type { Buckets, Slot } from './mix.ts';
import type { Memory } from './memory.ts';
import type { Model, Report, Vacancy } from './rules.ts';
import type { Rules } from './score.ts';

import { sendApply } from './apply.ts';
import { keepVacancy } from './corpus.ts';
import { fillKnownForm } from './form.ts';
import { judge, packReport } from './judge.ts';
import { searchVacancies } from './hh-api.ts';
import { LOOK_PER_START, MODEL_PER_START, QUEUE_TARGET, SEND_PER_DAY } from './limits.ts';
import { readMemory, remember, writeMemory } from './memory.ts';
import { FRONT_TAKE, hasSlot, roleJunk, stepSlot, takeSlot, taste } from './mix.ts';
import { modelFromEnv, modelsDown } from './model.ts';
import { pendingCount } from './queue.ts';
import { hardSkip } from './rules.ts';
import { byScore, ruleSkip, rulesFromEnv, scoreOf } from './score.ts';

export type ScanRun = { reports: Report[]; already: number };

export type ScanOpts = {
  query: string;
  dry: boolean;
  live: boolean;
  model?: Model | null;
  rules?: Rules;
  load?: (query: string, limit: number) => Promise<Vacancy[]>;
  signal?: AbortSignal;
};

export async function scan(opts: ScanOpts): Promise<ScanRun> {
  const load = opts.load ?? searchVacancies;
  const rules = opts.rules ?? rulesFromEnv();
  const model = opts.model === undefined ? modelFromEnv() : opts.model;
  const dry = opts.dry || opts.live === false;
  let memory: Memory | null = opts.live ? await readMemory() : null;
  let room = opts.live ? await queueRoom(memory as Memory) : Number.POSITIVE_INFINITY;
  let modelUsed = 0;
  const reports: Report[] = [];

  const found = await load(opts.query, LOOK_PER_START);
  const seen = memory?.seen;
  const already = seen === undefined ? 0 : found.filter(vacancy => seen.includes(vacancy.id)).length;
  const fresh = found.filter(vacancy => memory?.seen.includes(vacancy.id) !== true).sort(byScore(rules));
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

    if (memory)
      memory = remember(memory, vacancy.id);

    reports.push(packReport(vacancy, 'skip', 'не та роль', dry));
  }

  let prefer: Slot = 'front';
  let left = FRONT_TAKE;

  while (opts.signal?.aborted !== true && hasSlot(buckets)) {
    if (room <= 0) {
      const held = takeSlot(buckets, prefer);
      if (held !== undefined) {
        const why = memory !== null && memory.sent >= SEND_PER_DAY ? 'потолок на сегодня' : 'очередь полная';
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
      ? await finish(vacancy, report, scoreOf(vacancy, rules))
      : report;

    if (memory)
      memory = remember(memory, vacancy.id);

    if (final.verdict === 'apply') {
      if (opts.live)
        room -= 1;

      const step = stepSlot(prefer, left);
      prefer = step.prefer;
      left = step.left;
    }

    reports.push(final);
  }

  if (memory)
    await writeMemory(memory);

  return { reports, already };
}

async function queueRoom(memory: Memory): Promise<number> {
  const queued = await pendingCount();

  return Math.min(QUEUE_TARGET - queued, SEND_PER_DAY - memory.sent - queued);
}

async function finish(vacancy: Vacancy, report: Report, score: number): Promise<Report> {
  if (vacancy.formUrl.length > 0) {
    const form = await fillKnownForm(vacancy.formUrl);
    if (form === 'human')
      return packReport(vacancy, 'human', 'форма', false);
  }

  const sent = await sendApply(vacancy, report.reason, score);
  if (sent === 'human')
    return packReport(vacancy, 'human', 'нет резюме', false);

  if (sent === 'again')
    return packReport(vacancy, 'skip', 'уже в очереди', false);

  return packReport(vacancy, 'apply', report.reason, false);
}

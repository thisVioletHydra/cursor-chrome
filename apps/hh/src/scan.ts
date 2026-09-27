import type { Memory } from './memory.ts';
import type { Model, Report, Vacancy } from './rules.ts';
import type { Rules } from './score.ts';

import { sendApply } from './apply.ts';
import { fillKnownForm } from './form.ts';
import { judge, packReport } from './judge.ts';
import { searchVacancies } from './hh-api.ts';
import { LOOK_PER_START, MODEL_PER_START, QUEUE_TARGET, SEND_PER_DAY } from './limits.ts';
import { readMemory, remember, writeMemory } from './memory.ts';
import { modelFromEnv } from './model.ts';
import { pendingCount } from './queue.ts';
import { byScore, ruleSkip, rulesFromEnv, scoreOf } from './score.ts';

export type ScanOpts = {
  query: string;
  dry: boolean;
  live: boolean;
  model?: Model | null;
  rules?: Rules;
  load?: (query: string, limit: number) => Promise<Vacancy[]>;
  signal?: AbortSignal;
};

export async function scan(opts: ScanOpts): Promise<Report[]> {
  const load = opts.load ?? searchVacancies;
  const rules = opts.rules ?? rulesFromEnv();
  const model = opts.model === undefined ? modelFromEnv() : opts.model;
  const dry = opts.dry || opts.live === false;
  let memory: Memory | null = opts.live ? await readMemory() : null;
  let room = opts.live ? await queueRoom(memory as Memory) : Number.POSITIVE_INFINITY;
  let modelUsed = 0;
  const reports: Report[] = [];

  const found = await load(opts.query, LOOK_PER_START);
  const fresh = found.filter(vacancy => memory?.seen.includes(vacancy.id) !== true).sort(byScore(rules));

  for (const vacancy of fresh) {
    if (opts.signal?.aborted)
      break;

    if (room <= 0) {
      const why = memory !== null && memory.sent >= SEND_PER_DAY ? 'потолок на сегодня' : 'очередь полная';
      reports.push(packReport(vacancy, 'human', why, dry));
      break;
    }

    const ruled = ruleSkip(vacancy, rules);
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

    const final = opts.live && report.verdict === 'apply'
      ? await finish(vacancy, report, scoreOf(vacancy, rules))
      : report;

    if (memory)
      memory = remember(memory, vacancy.id);

    if (final.verdict === 'apply' && opts.live)
      room -= 1;

    reports.push(final);
  }

  if (memory)
    await writeMemory(memory);

  return reports;
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

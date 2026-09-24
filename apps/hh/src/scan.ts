import type { Model, Report, Vacancy } from './rules.ts';

import { sendApply } from './apply.ts';
import { fillKnownForm } from './form.ts';
import { judge } from './judge.ts';
import { searchVacancies } from './hh-api.ts';
import { APPLY_PAUSE_MS, LOOK_PER_START, MODEL_PER_START, SEND_PER_START } from './limits.ts';
import { canSend, readMemory, remember, writeMemory } from './memory.ts';
import { mistralFromEnv } from './mistral.ts';
import { lineOf } from './rules.ts';

export type ScanOpts = {
  query: string;
  dry: boolean;
  live: boolean;
  model?: Model | null;
  load?: (query: string, limit: number) => Promise<Vacancy[]>;
  signal?: AbortSignal;
};

export async function scan(opts: ScanOpts): Promise<Report[]> {
  const load = opts.load ?? searchVacancies;
  const vacancies = await load(opts.query, LOOK_PER_START);
  const model = opts.model === undefined ? mistralFromEnv() : opts.model;
  let modelUsed = 0;
  const memory = opts.live ? await readMemory() : null;
  let sentThisStart = 0;
  const reports: Report[] = [];

  for (const vacancy of vacancies) {
    if (opts.signal?.aborted)
      break;

    if (memory?.seen.includes(vacancy.id))
      continue;

    const report = await judge(vacancy, {
      dry: opts.dry || opts.live === false,
      model,
      modelLeft: () => modelUsed < MODEL_PER_START,
      takeModel: () => {
        modelUsed += 1;
      },
    });

    const next = await finish(vacancy, report, {
      live: opts.live,
      memory,
      sentThisStart,
    });
    sentThisStart = next.sentThisStart;
    if (next.memory)
      await writeMemory(next.memory);

    reports.push(next.report);
    if (next.stop)
      break;

    if (opts.live && next.report.verdict === 'apply')
      await pause(opts.signal);
  }

  return reports;
}

async function finish(
  vacancy: Vacancy,
  report: Report,
  state: { live: boolean; memory: Awaited<ReturnType<typeof readMemory>> | null; sentThisStart: number },
): Promise<{ report: Report; memory: typeof state.memory; sentThisStart: number; stop: boolean }> {
  if (state.live === false || report.verdict !== 'apply')
    return { report, memory: state.memory, sentThisStart: state.sentThisStart, stop: false };

  const memory = state.memory ?? await readMemory();
  if (canSend(memory, state.sentThisStart, SEND_PER_START) === false) {
    const capped = rewrite(report, 'human', 'потолок на сегодня');

    return { report: capped, memory: remember(memory, vacancy.id, false), sentThisStart: state.sentThisStart, stop: true };
  }

  if (vacancy.formUrl.length > 0) {
    const form = await fillKnownForm(vacancy.formUrl);
    if (form === 'human')
      return { report: rewrite(report, 'human', 'форма'), memory: remember(memory, vacancy.id, false), sentThisStart: state.sentThisStart, stop: false };
  }

  const sent = await sendApply(vacancy.id);
  if (sent === 'limit')
    return { report: rewrite(report, 'human', 'лимит HH'), memory: remember(memory, vacancy.id, false), sentThisStart: state.sentThisStart, stop: true };

  if (sent !== 'sent' && sent !== 'again')
    return { report: rewrite(report, 'human', 'HH не принял'), memory: remember(memory, vacancy.id, false), sentThisStart: state.sentThisStart, stop: false };

  const applied = rewrite(report, 'apply', report.reason);

  return {
    report: { ...applied, line: lineOf(vacancy.company, 'apply', report.reason, vacancy.url, false) },
    memory: remember(memory, vacancy.id, sent === 'sent'),
    sentThisStart: state.sentThisStart + (sent === 'sent' ? 1 : 0),
    stop: false,
  };
}

function rewrite(report: Report, verdict: Report['verdict'], reason: string): Report {
  return {
    ...report,
    verdict,
    reason,
    line: lineOf(report.company, verdict, reason, report.url, false),
  };
}

function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, APPLY_PAUSE_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

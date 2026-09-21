import { ensureHhWorker } from './worker-tab';

const HOST_MISSING = /native messaging host not found|forbidden|does not exist|install-host/i;

export type ConnSnap = {
  connected: boolean;
  detail: string;
  transport: 'native' | 'offscreen' | 'none';
};

export type GoodReport = {
  ok: boolean;
  report: string;
  step?: string;
  reason?: string;
  url?: string;
  transport?: string;
  detail?: string;
  fix?: string;
};

type Link = {
  reconnect: () => Promise<{ ok: boolean; error?: string; detail?: string }>;
  snapshot: () => ConnSnap;
};

export async function runMakeGood(link: Link): Promise<GoodReport> {
  let worker;
  try {
    worker = await ensureHhWorker();
  }
  catch (error) {
    return fail({
      step: 'worker',
      reason: 'не удалось открыть HH',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'открой Edge с unpacked и нажми Сделай хорошо ещё раз',
    });
  }

  if (worker.ok === false) {
    return fail({
      step: 'worker',
      reason: worker.reason || 'вкладка не готова',
      url: worker.url,
      fix: workerFix(worker.reason),
    });
  }

  const recon = await link.reconnect();
  if (recon.ok === false) {
    return fail({
      step: 'host',
      reason: 'reconnect упал',
      url: worker.url,
      detail: recon.error || recon.detail,
      fix: 'pnpm install-host',
    });
  }

  const snap = await waitSnap(link);
  if (snap.connected) {
    return {
      ok: true,
      report: [
        'Cursor Chrome: CONNECT',
        `transport: ${snap.transport}`,
        `url: ${worker.url || ''}`,
        snap.detail ? `detail: ${snap.detail}` : '',
      ].filter(Boolean).join('\n'),
      url: worker.url,
      transport: snap.transport,
      detail: snap.detail,
    };
  }

  if (HOST_MISSING.test(snap.detail)) {
    return fail({
      step: 'host',
      reason: 'нет native host',
      url: worker.url,
      transport: snap.transport,
      detail: snap.detail,
      fix: 'pnpm install-host',
    });
  }

  return fail({
    step: 'mcp',
    reason: 'MCP не слушает :18765',
    url: worker.url,
    transport: snap.transport,
    detail: snap.detail,
    fix: 'запусти MCP (pnpm --filter @cursor-chrome/mcp start) и нажми Сделай хорошо ещё раз',
  });
}

async function waitSnap(link: Link): Promise<ConnSnap> {
  const until = Date.now() + 1_500;
  while (Date.now() < until) {
    const snap = link.snapshot();
    if (snap.connected)
      return snap;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return link.snapshot();
}

function workerFix(reason?: string): string {
  const fixes: Record<string, string> = {
    'вкладка не выбрана': 'нажми Сделай хорошо ещё раз — расширение само откроет HH',
    'вкладка закрыта': 'нажми Сделай хорошо ещё раз — откроем HH в фоне',
    'не HH': 'открой hh.ru или нажми Сделай хорошо',
    'пин снят': 'нажми Сделай хорошо — запиним снова',
  };

  return fixes[reason || ''] || 'нажми Сделай хорошо ещё раз';
}

type FailFields = {
  step: string;
  reason: string;
  url?: string;
  transport?: string;
  detail?: string;
  fix?: string;
};

function fail(fields: FailFields): GoodReport {
  const extra = (['url', 'transport', 'detail', 'fix'] as const)
    .filter(key => typeof fields[key] === 'string')
    .map(key => `${key}: ${fields[key]}`);
  const lines = [
    'Cursor Chrome: FAIL',
    `step: ${fields.step}`,
    `reason: ${fields.reason}`,
    ...extra,
  ];

  return { ok: false, report: lines.join('\n'), ...fields };
}

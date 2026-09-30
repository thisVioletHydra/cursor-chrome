export const SERVER_WAIT = 'жду сервер';
export const TEA_PERIOD_MS = 45 * 60 * 1000;

export type RunDecision = {
  on: boolean;
  closeBotTab: boolean;
  status: string;
};

export type RunFault = '502' | 'timeout' | 'network';

export type RunStop = 'user' | 'captcha' | 'hang' | 'daily';

export type RunTouch = 'pin' | 'wake' | 'restore';

export type RunEvent =
  | { type: 'server'; fault: RunFault; justEnabled: boolean }
  | { type: 'stop'; reason: RunStop }
  | { type: 'touch'; action: RunTouch; on: boolean }
  | { type: 'pair'; on: boolean; botTab: boolean; explicitStop: boolean };

const STOP_STATUS: Record<RunStop, string> = {
  user: 'выключено',
  captcha: 'капча, позови человека',
  hang: 'я завис',
  daily: 'лимит на сегодня',
};

export function nextRun(event: RunEvent): RunDecision {
  if (event.type === 'server')
    return serverRun(event);

  if (event.type === 'stop')
    return { on: false, closeBotTab: true, status: STOP_STATUS[event.reason] };

  if (event.type === 'touch')
    return touchRun(event);

  return pairRun(event);
}

export function teaFires(input: { runMs: number; needMs: number; teaDue: number | null }): boolean {
  if (dueIsClock(input.teaDue) === false)
    return false;

  if (input.runMs < TEA_PERIOD_MS)
    return false;

  if (input.needMs <= 0)
    return false;

  return input.runMs >= input.needMs;
}

export function nextSearchPage(page: number, hasNext: boolean): number | null {
  if (hasNext === false)
    return null;

  if (Number.isInteger(page) === false || page < 0)
    return null;

  return page + 1;
}

function serverRun(event: { fault: RunFault; justEnabled: boolean }): RunDecision {
  if (event.justEnabled && knownFault(event.fault))
    return { on: true, closeBotTab: false, status: SERVER_WAIT };

  return { on: false, closeBotTab: false, status: '' };
}

function knownFault(fault: RunFault): boolean {
  return fault === '502' || fault === 'timeout' || fault === 'network';
}

function touchRun(event: { action: RunTouch; on: boolean }): RunDecision {
  if (event.action === 'pin' || event.action === 'wake' || event.action === 'restore')
    return { on: event.on, closeBotTab: false, status: '' };

  return { on: false, closeBotTab: true, status: '' };
}

function pairRun(event: { on: boolean; botTab: boolean; explicitStop: boolean }): RunDecision {
  if (event.explicitStop)
    return { on: false, closeBotTab: true, status: '' };

  if (event.botTab)
    return { on: true, closeBotTab: false, status: '' };

  if (event.on === false)
    return { on: false, closeBotTab: true, status: '' };

  return { on: true, closeBotTab: false, status: '' };
}

function dueIsClock(teaDue: number | null): boolean {
  if (teaDue === null)
    return true;

  return Number.isFinite(teaDue);
}

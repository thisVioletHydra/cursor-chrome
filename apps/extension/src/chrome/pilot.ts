export const SERVER_WAIT = 'жду сервер';
export const SERVER_SILENT = 'сервер не ответил, попробуй позже';
export const SERVER_DIE_MS = 3 * 60 * 1000;
export const TEA_PERIOD_MS = 45 * 60 * 1000;

export type Pilot = {
  on: boolean;
  closeBotTab: boolean;
  status: string;
  tea: boolean;
  page: number | null;
};

export type PilotFault = '502' | 'timeout' | 'unreachable';

export type PilotStop = 'user' | 'captcha' | 'hang' | 'daily' | 'feed';

export type PilotTouch = 'pin' | 'wake' | 'restore' | 'popup' | 'discarded' | 'tab';

export type PilotEvent =
  | { type: 'server'; fault: PilotFault }
  | { type: 'stop'; reason: PilotStop }
  | { type: 'touch'; action: PilotTouch }
  | { type: 'enable' }
  | { type: 'close-tab' }
  | { type: 'pair'; botTab: boolean; explicitStop: boolean }
  | { type: 'tea'; runMs: number; needMs: number; teaDue: number | null }
  | { type: 'page'; page: number; hasNext: boolean };

const STOP_STATUS: Record<PilotStop, string> = {
  user: 'выключено',
  captcha: 'капча, позови человека',
  hang: 'я завис',
  daily: 'лимит на сегодня',
  feed: 'вакансии походу закончились',
};

const SERVER_STATUS: Record<PilotFault, string> = {
  502: SERVER_WAIT,
  timeout: SERVER_WAIT,
  unreachable: SERVER_WAIT,
};

const TOUCH: Record<PilotTouch, true> = {
  pin: true,
  wake: true,
  restore: true,
  popup: true,
  discarded: true,
  tab: true,
};

export function freshPilot(): Pilot {
  return { on: false, closeBotTab: false, status: '', tea: false, page: null };
}

export function pilotStep(state: Pilot, event: PilotEvent): Pilot {
  if (event.type === 'server')
    return serverStep(state, event.fault);

  if (event.type === 'stop')
    return stopStep(state, event.reason);

  if (event.type === 'touch')
    return touchStep(state, event.action);

  if (event.type === 'enable')
    return { ...state, on: true, closeBotTab: false, tea: false };

  if (event.type === 'close-tab')
    return { ...state, closeBotTab: true };

  if (event.type === 'tea')
    return { ...state, closeBotTab: false, tea: teaReady(event) };

  if (event.type === 'page')
    return { ...state, closeBotTab: false, page: pageAfter(event.page, event.hasNext) };

  return pairStep(state, event);
}

function serverStep(state: Pilot, fault: PilotFault): Pilot {
  if (state.on === false)
    return { ...state, closeBotTab: false };

  return { ...state, on: true, closeBotTab: false, status: SERVER_STATUS[fault] };
}

function stopStep(state: Pilot, reason: PilotStop): Pilot {
  return { ...state, on: false, closeBotTab: true, status: STOP_STATUS[reason], tea: false };
}

function touchStep(state: Pilot, action: PilotTouch): Pilot {
  if (TOUCH[action] !== true)
    return stopStep(state, 'user');

  return { ...state, closeBotTab: false };
}

function pairStep(state: Pilot, event: { botTab: boolean; explicitStop: boolean }): Pilot {
  if (event.explicitStop)
    return { ...state, on: false, closeBotTab: true, tea: false };

  if (event.botTab)
    return { ...state, on: true, closeBotTab: false };

  if (state.on === false)
    return { ...state, on: false, closeBotTab: true, tea: false };

  return { ...state, closeBotTab: false };
}

function teaReady(input: { runMs: number; needMs: number; teaDue: number | null }): boolean {
  if (dueIsClock(input.teaDue) === false)
    return false;

  if (input.runMs < TEA_PERIOD_MS)
    return false;

  if (input.needMs <= 0)
    return false;

  return input.runMs >= input.needMs;
}

function dueIsClock(teaDue: number | null): boolean {
  if (teaDue === null)
    return true;

  return Number.isFinite(teaDue);
}

export function serverWaitOver(since: number, now: number): boolean {
  if (Number.isFinite(since) === false || since <= 0)
    return false;

  if (Number.isFinite(now) === false)
    return false;

  return now - since >= SERVER_DIE_MS;
}

function pageAfter(page: number, hasNext: boolean): number | null {
  if (hasNext === false)
    return null;

  if (Number.isInteger(page) === false || page < 0)
    return null;

  return page + 1;
}

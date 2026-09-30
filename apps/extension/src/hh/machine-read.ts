import { SERVER_WAIT } from '../chrome/pilot';
import { pulseLines } from '../pilot/wait-pulse';
import { browser } from '../browser-host';
import { ask } from './bridge';

export type Snap = {
  show: boolean;
  auto: boolean;
  link: string;
  pinned: boolean | null;
  rows: string[];
  stall: boolean;
  step: string;
  busy: boolean;
  reason: string;
};

export function machineWanted(raw: unknown): boolean {
  if (field(raw, 'showMachine') === true)
    return true;

  return field(field(raw, 'flags'), 'showMachine') === true;
}

export async function readSnap(): Promise<Snap | null> {
  let stored: unknown;
  try {
    stored = await browser.storage.local.get(['flags', 'pilotLink', 'queueBusy', 'queueReport']);
  }
  catch {
    return null;
  }

  const [log, worker] = await Promise.all([
    ask({ type: 'page-log-get' }),
    ask({ type: 'check-worker' }),
  ]);
  const flags = field(stored, 'flags');

  return {
    show: field(flags, 'showMachine') === true,
    auto: field(flags, 'autoQueue') === true,
    link: textOf(field(stored, 'pilotLink')),
    pinned: pinnedOf(worker),
    rows: stringsOf(field(log, 'lines')),
    stall: field(log, 'stall') === true,
    step: textOf(field(log, 'step')),
    busy: field(stored, 'queueBusy') === true,
    reason: textOf(field(field(stored, 'queueReport'), 'reason')),
  };
}

export function statusLines(snap: Snap): string[] {
  const lines: string[] = [];
  const detail = pulseLines(waitText(snap));
  if (detail !== null)
    lines.push(...detail);

  lines.push(snap.link.length > 0 ? snap.link : (snap.auto ? 'вкл' : 'выкл'), pinLine(snap.pinned));
  const step = currentStep(snap);
  if (detail === null && step.length > 0)
    lines.push(`шаг: ${step}`);

  const flags = flagLine(snap);
  if (flags.length > 0)
    lines.push(flags);

  const stuck = stuckLine(snap);
  if (stuck.length > 0 && lines.includes(stuck) === false)
    lines.push(stuck);

  return lines;
}

function pinLine(pinned: boolean | null): string {
  if (pinned === null)
    return 'пин: ?';

  if (pinned)
    return 'пин: да';

  return 'пин: нет';
}

function waitText(snap: Snap): string {
  for (let index = snap.rows.length - 1; index >= 0; index -= 1) {
    const line = snap.rows[index] ?? '';
    if (line.length === 0 || hang(line))
      continue;

    if (pulseLines(line) !== null)
      return line;

    return '';
  }

  return '';
}

function currentStep(snap: Snap): string {
  const last = snap.rows[snap.rows.length - 1] ?? '';
  if (last.length > 0 && hang(last) === false)
    return last;

  if (snap.step.length > 0)
    return snap.step;

  if (snap.reason === 'страницы кончились')
    return snap.reason;

  if (snap.busy)
    return 'читаю';

  return '';
}

function stuckLine(snap: Snap): string {
  const last = snap.rows[snap.rows.length - 1] ?? '';
  if (hang(last))
    return last;

  if (snap.stall && snap.step.length > 0)
    return `я завис: ${snap.step}`;

  if (snap.stall || snap.reason === 'я завис' || snap.reason === 'расширение зависло')
    return 'я завис';

  if (snap.reason === 'сервер молчит')
    return snap.reason;

  return '';
}

function flagLine(snap: Snap): string {
  const on: string[] = [];
  if (snap.auto)
    on.push('автопилот');

  if (snap.pinned === true)
    on.push('пин');

  if (snap.link === SERVER_WAIT)
    on.push(SERVER_WAIT);

  if (on.length === 0)
    return '';

  return `флаги: ${on.join(', ')}`;
}

function hang(line: string): boolean {
  return line.startsWith('я завис') || line === 'сервер молчит';
}

function field(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null || Object.hasOwn(raw, key) === false)
    return undefined;

  for (const [name, value] of Object.entries(raw)) {
    if (name === key)
      return value;
  }

  return undefined;
}

function textOf(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function stringsOf(raw: unknown): string[] {
  if (Array.isArray(raw) === false)
    return [];

  return raw.filter((item): item is string => typeof item === 'string');
}

function pinnedOf(raw: unknown): boolean | null {
  if (field(raw, 'ok') === true)
    return true;

  if (field(raw, 'ok') === false)
    return false;

  return null;
}

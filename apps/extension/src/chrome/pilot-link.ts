import { browser } from '../browser-host';
import { getFlags } from './flags';

const LINK_KEY = 'pilotLink';
const PENDING_KEY = 'pilotPending';

export const PILOT_LINK_KEY = LINK_KEY;
export const SERVER_SILENT = 'сервер не ответил, попробуй позже';
export const SERVER_WAIT = 'жду сервер';

type Pending = 'on' | 'off' | '';

export function isPilotLinkText(text: string): boolean {
  return text === SERVER_SILENT || text === SERVER_WAIT;
}

export function gatewayText(status: number): string | null {
  if (status === 502 || status === 503 || status === 504)
    return SERVER_WAIT;

  return null;
}

export async function readPilotLink(): Promise<string> {
  const stored = await browser.storage.local.get(LINK_KEY);
  const text = stored[LINK_KEY];

  return typeof text === 'string' ? text : '';
}

export async function notePilotLink(text: string): Promise<void> {
  const clean = text.trim();
  if (clean.length === 0)
    return;

  if (await readPilotLink() === clean)
    return;

  await browser.storage.local.set({ [LINK_KEY]: clean });
}

export async function clearPilotLink(): Promise<void> {
  if ((await readPilotLink()).length === 0)
    return;

  await browser.storage.local.remove(LINK_KEY);
}

export async function noteGateway(status: number): Promise<void> {
  const text = gatewayText(status);
  if (text === null)
    return;

  const matters = await linkMatters();
  if (matters)
    await notePilotLink(text);
}

export async function noteServerSilent(): Promise<void> {
  const matters = await linkMatters();
  if (matters)
    await notePilotLink(SERVER_SILENT);
}

export async function readPilotPending(): Promise<Pending> {
  const stored = await browser.storage.local.get(PENDING_KEY);
  const value = stored[PENDING_KEY];
  if (value === 'on' || value === 'off')
    return value;

  return '';
}

export async function setPilotPending(next: 'on' | 'off'): Promise<void> {
  if (await readPilotPending() === next)
    return;

  await browser.storage.local.set({ [PENDING_KEY]: next });
}

export async function clearPilotPending(): Promise<void> {
  if ((await readPilotPending()) === '')
    return;

  await browser.storage.local.remove(PENDING_KEY);
}

// Старый stop:true ещё от зависания, пока этот запуск сервер не принял.
export async function remoteStopCounts(): Promise<boolean> {
  return (await readPilotPending()) !== 'on';
}

export async function notePilotAnswer(body: unknown): Promise<void> {
  const pending = await readPilotPending();
  const auto = bodyAuto(body);
  if (pending === 'on' && auto === false)
    return;

  if (pending === 'on')
    await clearPilotPending();

  if (pending === 'off')
    return;

  await clearPilotLink();
}

async function linkMatters(): Promise<boolean> {
  const pending = await readPilotPending();
  if (pending === 'on')
    return true;

  if (pending === 'off')
    return false;

  const flags = await getFlags();

  return flags.autoQueue === true;
}

function bodyAuto(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'auto' in body && body.auto === true;
}

import { getFlags } from './flags';
import { freshPilot, pilotStep, SERVER_SILENT, SERVER_WAIT } from '../chrome/pilot';
import { browser } from '../browser-host';

const LINK_KEY = 'pilotLink';
const PENDING_KEY = 'pilotPending';
const DOWN_KEY = 'serverDownAt';

export const PILOT_LINK_KEY = LINK_KEY;

export { SERVER_SILENT, SERVER_WAIT };

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
  if (clean === SERVER_WAIT)
    await noteServerDown();
}

export async function clearPilotLink(): Promise<void> {
  if ((await readPilotLink()).length > 0)
    await browser.storage.local.remove(LINK_KEY);

  await clearServerDown();
}

export async function readServerDown(): Promise<number> {
  const stored = await browser.storage.local.get(DOWN_KEY);
  const at = stored[DOWN_KEY];

  return typeof at === 'number' && at > 0 ? at : 0;
}

async function noteServerDown(): Promise<void> {
  if ((await readServerDown()) > 0)
    return;

  await browser.storage.local.set({ [DOWN_KEY]: Date.now() });
}

async function clearServerDown(): Promise<void> {
  if ((await readServerDown()) === 0)
    return;

  await browser.storage.local.remove(DOWN_KEY);
}

export async function noteGateway(status: number): Promise<void> {
  if (status !== 502 && status !== 503 && status !== 504)
    return;

  const matters = await linkMatters();
  if (matters === false)
    return;

  const decided = pilotStep({ ...freshPilot(), on: true }, { type: 'server', fault: '502' });
  if (decided.on === false || decided.closeBotTab)
    return;

  await notePilotLink(decided.status);
}

export async function noteServerSilent(): Promise<void> {
  const matters = await linkMatters();
  if (matters === false)
    return;

  const decided = pilotStep({ ...freshPilot(), on: true }, { type: 'server', fault: 'unreachable' });
  if (decided.on === false || decided.closeBotTab)
    return;

  await notePilotLink(decided.status);
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

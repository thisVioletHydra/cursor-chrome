import { getSyncKey, getSyncUrl } from './apply-log';
import { setFlags } from './flags';
import { bumpPilot } from './page-log';
import { clearPilotLink, clearPilotPending, gatewayText, notePilotLink, readPilotPending, SERVER_SILENT } from './pilot-link';
import { nextRun } from './run-next';
import { closePinnedHh } from './worker-tab';

const PUSH_MS = 12_000;
const RETRY_MS = 60_000;

let pushing = false;
let pushedAt = 0;

export async function pushPilot(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  bumpPilot();
  pushedAt = Date.now();
  pushing = true;
  try {
    return await postPilot(on);
  }
  finally {
    pushing = false;
  }
}

export async function retryPilotPush(): Promise<boolean> {
  if (pushing || Date.now() - pushedAt < RETRY_MS)
    return false;

  const pending = await readPilotPending();
  if (pending === '')
    return false;

  const pushed = await pushPilot(pending === 'on');
  if (pushed.ok === false) {
    if (pending === 'on')
      await notePilotLink(pushed.error);

    return false;
  }

  await clearPilotPending();
  await clearPilotLink();

  return pending === 'on';
}

async function postPilot(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await pilotAuth();
  if (auth === null)
    return { ok: false, error: 'нет адреса админки' };

  try {
    const res = await fetch(`${auth.host}/api/auto`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ on }),
      signal: AbortSignal.timeout(PUSH_MS),
    });
    const body = await res.json().catch(() => null) as { error?: unknown; ok?: unknown } | null;
    if (res.ok && body?.ok !== false)
      return { ok: true };

    const detail = typeof body?.error === 'string' ? body.error : '';
    const down = gatewayText(res.status);
    if (down !== null && on)
      return serverDown('502');

    return { ok: false, error: down ?? (detail.length > 0 ? detail : `сервер ${res.status}`) };
  }
  catch (error) {
    if (on)
      return serverDown(timedOut(error) ? 'timeout' : 'network');

    return { ok: false, error: SERVER_SILENT };
  }
}

async function serverDown(fault: '502' | 'timeout' | 'network'): Promise<{ ok: false; error: string }> {
  const decision = nextRun({ type: 'server', fault, justEnabled: true });
  if (decision.on === false)
    await setFlags({ autoQueue: false });

  if (decision.closeBotTab)
    await closePinnedHh();

  return { ok: false, error: decision.status };
}

function timedOut(error: unknown): boolean {
  if (typeof error !== 'object' || error === null)
    return false;

  const name = 'name' in error ? error.name : '';

  return name === 'TimeoutError' || name === 'AbortError';
}

async function pilotAuth(): Promise<{ host: string; key: string } | null> {
  const raw = (await getSyncUrl()).trim();
  const key = await getSyncKey();
  if (raw.length === 0 || key.length === 0)
    return null;

  try {
    const url = new URL(raw);

    return { host: `${url.protocol}//${url.host}`, key };
  }
  catch {
    return null;
  }
}

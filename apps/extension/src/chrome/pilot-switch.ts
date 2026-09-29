import { getSyncKey, getSyncUrl } from './apply-log';
import { bumpPilot } from './page-log';

export async function pushPilot(on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  bumpPilot();
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
    });
    const body = await res.json().catch(() => null) as { error?: unknown; ok?: unknown } | null;
    if (res.ok === false || body?.ok === false) {
      const error = typeof body?.error === 'string' && body.error.length > 0
        ? body.error
        : `сервер ${res.status}`;

      return { ok: false, error };
    }

    return { ok: true };
  }
  catch {
    return { ok: false, error: 'сервер не ответил' };
  }
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

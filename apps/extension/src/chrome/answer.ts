import { getSyncKey } from './apply-log';
import { syncBase } from './queue-run';

export type CloudAnswer = { answer?: string; human?: boolean; reason?: string };

export async function askCloud(question: Record<string, unknown>): Promise<CloudAnswer> {
  const base = await syncBase();
  const key = await getSyncKey();
  if (base.length === 0 || key.length === 0)
    return { human: true, reason: 'админка не подключена' };

  try {
    const res = await fetch(`${base}/api/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(question),
    });
    if (res.ok === false)
      return { human: true, reason: `админка ${res.status}` };

    const body = await res.json() as CloudAnswer;

    return typeof body.answer === 'string' ? { answer: body.answer } : { human: true, reason: body.reason || 'нет факта' };
  }
  catch {
    return { human: true, reason: 'админка не ответила' };
  }
}

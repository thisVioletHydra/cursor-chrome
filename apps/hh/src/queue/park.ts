import { forgetLinks, notePassed, remember } from '../diary/memory.ts';
import { dropWaiters, readQueue, staleWaiters } from './queue.ts';

export async function parkStaleWaiters(): Promise<void> {
  const picked = staleWaiters(await readQueue());
  if (picked.length === 0)
    return;

  const ids = picked.map(row => row.id);
  await remember(ids);
  await forgetLinks(ids);
  await notePassed(picked.map(row => ({
    id: row.id,
    reason: 'протухло',
    company: row.company,
    title: row.title,
  })));
  await dropWaiters(ids);
}

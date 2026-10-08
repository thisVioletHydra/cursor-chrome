import type { Vacancy } from './rules.ts';

import { enqueue } from '../queue/queue.ts';

export async function sendApply(vacancy: Vacancy, reason: string, score = 0): Promise<'queued' | 'again'> {
  const added = await enqueue({
    id: vacancy.id,
    company: vacancy.company,
    title: vacancy.title,
    url: vacancy.url,
    reason,
    score,
    ...(vacancy.foundBy ? { foundBy: vacancy.foundBy } : {}),
    ...(vacancy.place ? { place: vacancy.place } : {}),
  });

  return added ? 'queued' : 'again';
}

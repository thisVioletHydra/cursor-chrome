import type { Vacancy } from './rules.ts';

import { enqueue } from './queue.ts';

import process from 'node:process';

export async function sendApply(vacancy: Vacancy, reason: string, score = 0): Promise<'queued' | 'again' | 'human'> {
  const resume = process.env.HH_RESUME_ID ?? '';
  if (resume.length === 0)
    return 'human';

  const added = await enqueue({
    id: vacancy.id,
    company: vacancy.company,
    title: vacancy.title,
    url: vacancy.url,
    reason,
    score,
  });

  return added ? 'queued' : 'again';
}

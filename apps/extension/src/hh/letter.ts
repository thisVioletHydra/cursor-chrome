import { browser } from '../browser-host';

export const COVER_LETTER = `Собрал CV в формате веб-приложения:
https://thisviolethydra.github.io/selfskills/

Стек: React + Vite + TypeScript, NestJS, GraphQL, Prisma, PostgreSQL, Docker Compose, Git.

Если словите 502 - сервер просыпается, подождите ~30 секунд.

Буду особенно благодарен за честный фидбек: что понравилось, что не понравилось и что стоит доработать. Даже небольшой, но конкретный комментарий очень поможет понять, что улучшить.`;

const LETTER_KEY = 'coverLetter';

export async function coverLetter(): Promise<string> {
  const stored = await browser.storage.local.get(LETTER_KEY);
  const saved = stored[LETTER_KEY];

  return typeof saved === 'string' && saved.trim().length > 0 ? saved : COVER_LETTER;
}

export async function setCoverLetter(text: string): Promise<void> {
  const clean = text.trim();
  if (clean.length === 0)
    return;

  await browser.storage.local.set({ [LETTER_KEY]: clean });
}

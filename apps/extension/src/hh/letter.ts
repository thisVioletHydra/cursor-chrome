import { browser } from '../browser-host';
import { localStore } from '../local/chrome-store';

// No letter text in code: it comes from the user's data (synced «coverLetter» or the local profile). Empty → none.
export const COVER_LETTER = '';

const LETTER_KEY = 'coverLetter';

export async function coverLetter(): Promise<string> {
  const stored = await browser.storage.local.get(LETTER_KEY);
  const saved = stored[LETTER_KEY];

  if (typeof saved === 'string' && saved.trim().length > 0)
    return saved;

  const local = await localStore.loadIndexed().catch(() => null);

  return local?.data.coverLetter.trim() || COVER_LETTER;
}

export async function setCoverLetter(text: string): Promise<void> {
  const clean = text.trim();
  if (clean.length === 0)
    return;

  await browser.storage.local.set({ [LETTER_KEY]: clean });
}

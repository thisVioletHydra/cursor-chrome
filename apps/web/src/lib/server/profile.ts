import type { Profile } from '@cursor-chrome/hh';

import { parseProfile } from '@cursor-chrome/hh';
import { ensureAccount, readAccount, writeAccount } from './secrets';

// Profile lives in the account file of each login; nothing about a specific person in code.
export async function readProfile(login: string): Promise<Profile | null> {
  const profile = parseProfile((await readAccount(login)).profile);

  return profile && profile.savedAt > 0 ? profile : null;
}

export async function saveProfile(login: string, raw: unknown): Promise<Profile | null> {
  const parsed = parseProfile(raw);
  if (parsed === null)
    return null;

  const profile: Profile = { ...parsed, savedAt: Date.now() };
  const account = await ensureAccount(login);
  await writeAccount(login, { ...account, profile: JSON.stringify(profile) });

  return profile;
}

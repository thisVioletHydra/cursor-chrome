import type { AccountFacts } from './copy.ts';
import type { Profile } from '../review/profile.ts';

import { ownerName } from '../diary/tenant.ts';
import { evaluateRule, parseProfile } from '../review/profile.ts';
import { parseFacts, setAccountFacts, setAnswerHints, setCoverLetter } from './copy.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Same rule as the web server's secrets dir: WEB_SECRETS dir → /data on Railway → ./data.
export function accountsDir(): string {
  if (process.env.HH_ACCOUNTS_DIR)
    return process.env.HH_ACCOUNTS_DIR;

  if (process.env.WEB_SECRETS)
    return path.join(path.dirname(process.env.WEB_SECRETS), 'accounts');

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data/accounts';

  return path.join(process.cwd(), 'data', 'accounts');
}

export function ownerAccountFile(): string {
  return process.env.HH_ACCOUNT_FILE || path.join(accountsDir(), `${ownerName()}.json`);
}

export type AppliedAccount = { facts: AccountFacts; profile: Profile | null; coverLetter: string };

// Put an account's personal data into the server-wide slots (facts, cover letter, answer hints).
// Used by the web server at start and by the hh CLI, so both behave the same.
export function applyAccount(account: { facts?: unknown; profile?: unknown; coverLetter?: unknown } | null): AppliedAccount {
  const facts = parseFacts(account?.facts);
  const profile = parseProfile(account?.profile);
  const coverLetter = String(account?.coverLetter ?? '');
  setAccountFacts(facts);
  setCoverLetter(coverLetter);
  setAnswerHints({
    salary: evaluateRule(profile?.fields.salary, {}),
    salaryNumber: evaluateRule(profile?.fields.salaryNumber, {}),
    contacts: evaluateRule(profile?.fields.contacts, {}),
  });

  return { facts, profile, coverLetter };
}

export async function loadOwnerAccount(file = ownerAccountFile()): Promise<{ file: string; found: boolean; applied: AppliedAccount }> {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(await fsPromises.readFile(file, 'utf8')) as Record<string, unknown>;
  }
  catch {
    parsed = null;
  }

  return { file, found: parsed !== null, applied: applyAccount(parsed) };
}

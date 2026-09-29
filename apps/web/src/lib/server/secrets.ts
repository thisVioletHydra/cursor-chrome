import type { Provider } from '@cursor-chrome/hh';

import { parseChain, parseJsonLoose, writeJsonAtomic } from '@cursor-chrome/hh';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type Secrets = {
  telegramToken: string;
  modelChain: string;
  hhAccessToken: string;
  hhClientId: string;
  hhClientSecret: string;
  hhResumeId: string;
  hhQuery: string;
  hhRules: string;
  hhCorpus: string;
  hhLive: string;
  extToken: string;
};

export type Labels = {
  telegramLabel: string;
  hhLabel: string;
};

export type Texts = {
  coverLetter: string;
};

export type Stored = Secrets & Labels & Texts;

export type Charge = {
  at: number;
  company: string;
  url: string;
  rub: number;
};

export type Account = Stored & {
  balance: number;
  history: Charge[];
};

export const CREATOR = 'thisVioletHydra';
export const VACANCY_RUB = 1;
export const GUEST_BALANCE = 200;

const empty = (): Account => ({
  telegramToken: '',
  modelChain: '',
  hhAccessToken: '',
  hhClientId: '',
  hhClientSecret: '',
  hhResumeId: '',
  hhQuery: '',
  hhRules: '',
  hhCorpus: '',
  hhLive: '',
  extToken: '',
  telegramLabel: '',
  hhLabel: '',
  coverLetter: '',
  balance: 0,
  history: [],
});

export function isCreator(login: string): boolean {
  return login.toLowerCase() === CREATOR.toLowerCase();
}

function rootDir(): string {
  if (process.env.WEB_SECRETS)
    return path.dirname(process.env.WEB_SECRETS);

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data';

  return path.join(process.cwd(), 'data');
}

function safeLogin(login: string): string {
  if (/^[A-Za-z0-9-]{1,39}$/.test(login) === false)
    throw new Error('login');

  return login;
}

function accountPath(login: string): string {
  return path.join(rootDir(), 'accounts', `${safeLogin(login)}.json`);
}

export async function readAccount(login: string): Promise<Account> {
  let text: string;
  try {
    text = await fsPromises.readFile(accountPath(login), 'utf8');
  }
  catch {
    return empty();
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null) {
    console.error(`account ${login}: файл не разобрать`);

    return empty();
  }

  const raw = parsed.value as Partial<Account> & { mistralKey?: string };
  const { mistralKey, ...rest } = raw;
  const account: Account = {
    ...empty(),
    ...rest,
    modelChain: migrateChain(raw.modelChain, mistralKey),
    hhRules: typeof raw.hhRules === 'string' ? raw.hhRules : '',
    hhCorpus: raw.hhCorpus === '1' ? '1' : '',
    hhLive: raw.hhLive === '1' ? '1' : '',
    balance: typeof raw.balance === 'number' ? raw.balance : 0,
    history: chargesOf(raw.history),
  };
  if (parsed.salvaged) {
    console.error(`account ${login}: восстановил из битого файла, перезаписал`);
    await writeAccount(login, account);
  }

  return account;
}

export async function writeAccount(login: string, next: Account): Promise<void> {
  await writeJsonAtomic(accountPath(login), next);
}

export async function accountFileStat(login: string): Promise<{ bytes: number; mtimeMs: number } | null> {
  try {
    const stat = await fsPromises.stat(accountPath(login));
    return { bytes: stat.size, mtimeMs: stat.mtimeMs };
  }
  catch {
    return null;
  }
}

function migrateChain(chain: unknown, mistralKey: unknown): string {
  if (typeof chain === 'string' && chain.length > 0)
    return chain;

  if (typeof mistralKey === 'string' && mistralKey.length > 0)
    return JSON.stringify([{ id: 'mistral', key: mistralKey }]);

  return '';
}

export function chainOf(account: Pick<Account, 'modelChain'>): Provider[] {
  return parseChain(account.modelChain);
}

/** Один провайдер на id. У Gemini остаётся 3.8, lite выкидывается. */
export function collapseChain(chain: Provider[]): Provider[] {
  const gemini = chain.filter(item => item.id === 'gemini');
  const keepGemini = gemini.find(item => item.model.includes('3.8')) ?? gemini[0];
  const seen = new Set<string>();
  const out: Provider[] = [];
  for (const item of chain) {
    if (item.id === 'gemini') {
      if (seen.has('gemini') || keepGemini === undefined || item.model !== keepGemini.model)
        continue;

      seen.add('gemini');
      out.push(keepGemini);
      continue;
    }

    if (seen.has(item.id))
      continue;

    seen.add(item.id);
    out.push(item);
  }

  return out;
}

export function withChain(account: Account, chain: Provider[]): Account {
  return { ...account, modelChain: chain.length > 0 ? JSON.stringify(chain) : '' };
}

const envKeys: Record<keyof Secrets, string> = {
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  modelChain: 'MODEL_CHAIN',
  hhAccessToken: 'HH_ACCESS_TOKEN',
  hhClientId: 'HH_CLIENT_ID',
  hhClientSecret: 'HH_CLIENT_SECRET',
  hhResumeId: 'HH_RESUME_ID',
  hhQuery: 'HH_QUERY',
  hhRules: 'HH_RULES',
  hhCorpus: 'HH_CORPUS',
  hhLive: 'HH_LIVE',
  extToken: 'EXT_TOKEN',
};

export const DEFAULT_QUERY = 'typescript react nestjs';

export function newExtToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function applySavedSecrets(): Promise<void> {
  const saved = await readAccount(CREATOR);
  for (const key of Object.keys(envKeys) as (keyof Secrets)[]) {
    if (saved[key].length > 0)
      process.env[envKeys[key]] = saved[key];
  }
}

export function publishSecrets(login: string, next: Secrets): void {
  if (isCreator(login) === false)
    return;

  for (const key of Object.keys(envKeys) as (keyof Secrets)[]) {
    if (next[key].length > 0)
      process.env[envKeys[key]] = next[key];
    else
      delete process.env[envKeys[key]];
  }
}

function chargesOf(value: unknown): Charge[] {
  if (Array.isArray(value) === false)
    return [];

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null)
      return [];

    const row = item as Partial<Charge>;
    if (typeof row.at !== 'number' || typeof row.company !== 'string' || typeof row.url !== 'string')
      return [];

    return [{ at: row.at, company: row.company, url: row.url, rub: typeof row.rub === 'number' ? row.rub : 0 }];
  }).slice(0, 80);
}

export async function takeVacancy(login: string, item: { company: string; url: string }): Promise<boolean> {
  const account = await readAccount(login);
  const creator = isCreator(login);
  if (creator === false && account.balance < VACANCY_RUB)
    return false;

  if (creator === false)
    account.balance -= VACANCY_RUB;

  account.history = [{
    at: Date.now(),
    company: item.company,
    url: item.url,
    rub: creator ? 0 : VACANCY_RUB,
  }, ...account.history].slice(0, 80);
  await writeAccount(login, account);

  return true;
}

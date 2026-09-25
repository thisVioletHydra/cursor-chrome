import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type Secrets = {
  telegramToken: string;
  mistralKey: string;
  hhAccessToken: string;
  hhResumeId: string;
};

export type Labels = {
  telegramLabel: string;
  mistralLabel: string;
  hhLabel: string;
};

export type Stored = Secrets & Labels;

export type Account = Stored & {
  balance: number;
};

export const CREATOR = 'thisVioletHydra';
export const VACANCY_RUB = 1;

const empty = (): Account => ({
  telegramToken: '',
  mistralKey: '',
  hhAccessToken: '',
  hhResumeId: '',
  telegramLabel: '',
  mistralLabel: '',
  hhLabel: '',
  balance: 0,
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
  try {
    const raw = JSON.parse(await fsPromises.readFile(accountPath(login), 'utf8')) as Partial<Account>;

    return { ...empty(), ...raw, balance: typeof raw.balance === 'number' ? raw.balance : 0 };
  }
  catch {
    return empty();
  }
}

export async function writeAccount(login: string, next: Account): Promise<void> {
  const file = accountPath(login);
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify(next));
}

const envKeys: Record<keyof Secrets, string> = {
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  mistralKey: 'MISTRAL_API_KEY',
  hhAccessToken: 'HH_ACCESS_TOKEN',
  hhResumeId: 'HH_RESUME_ID',
};

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

export async function takeVacancy(login: string): Promise<boolean> {
  if (isCreator(login))
    return true;

  const account = await readAccount(login);
  if (account.balance < VACANCY_RUB)
    return false;

  account.balance -= VACANCY_RUB;
  await writeAccount(login, account);

  return true;
}

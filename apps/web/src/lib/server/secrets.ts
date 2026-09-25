import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type Secrets = {
  telegramToken: string;
  mistralKey: string;
  hhAccessToken: string;
  hhResumeId: string;
};

const empty: Secrets = {
  telegramToken: '',
  mistralKey: '',
  hhAccessToken: '',
  hhResumeId: '',
};

function filePath(): string {
  if (process.env.WEB_SECRETS)
    return process.env.WEB_SECRETS;

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data/web-secrets.json';

  return path.join(process.cwd(), 'data', 'web-secrets.json');
}

export async function readSecrets(): Promise<Secrets> {
  try {
    const raw = JSON.parse(await fsPromises.readFile(filePath(), 'utf8')) as Partial<Secrets>;

    return { ...empty, ...raw };
  }
  catch {
    return { ...empty };
  }
}

const UNDO_MS = 15_000;
let pendingUndo: { at: number; secrets: Secrets } | null = null;

export function stageUndo(previous: Secrets): void {
  pendingUndo = { at: Date.now(), secrets: { ...previous } };
}

export function takeUndo(): Secrets | null {
  if (pendingUndo === null)
    return null;

  const fresh = Date.now() - pendingUndo.at <= UNDO_MS;
  const secrets = pendingUndo.secrets;
  pendingUndo = null;
  if (fresh === false)
    return null;

  return secrets;
}

export async function writeSecrets(next: Secrets): Promise<void> {
  const file = filePath();
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
  const saved = await readSecrets();
  for (const key of Object.keys(envKeys) as (keyof Secrets)[]) {
    const value = secretValue(key, saved);
    if (value.length > 0)
      process.env[envKeys[key]] = value;
  }
}

export function publishSecrets(next: Secrets): void {
  for (const key of Object.keys(envKeys) as (keyof Secrets)[]) {
    if (next[key].length > 0)
      process.env[envKeys[key]] = next[key];
    else
      delete process.env[envKeys[key]];
  }
}

export function secretValue(name: keyof Secrets, saved: Secrets): string {
  const fromEnv: Record<keyof Secrets, string | undefined> = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    mistralKey: process.env.MISTRAL_API_KEY,
    hhAccessToken: process.env.HH_ACCESS_TOKEN,
    hhResumeId: process.env.HH_RESUME_ID,
  };
  return fromEnv[name] || saved[name] || '';
}

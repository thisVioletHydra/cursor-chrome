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

export async function writeSecrets(next: Secrets): Promise<void> {
  const file = filePath();
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify(next));
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

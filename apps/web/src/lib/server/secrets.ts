import type { AtsFlag, Provider } from '@cursor-chrome/hh';

import { asAtsFlags, parseChain, parseJsonLoose, writeJsonAtomic } from '@cursor-chrome/hh';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { channelName } from './channel-feed';

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
  hhHours: string;
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

export type Imitation = {
  readMin: number;
  readMax: number;
  distractMin: number;
  distractMax: number;
  fastEvery: number;
  fastMin: number;
  fastMax: number;
};

export const IMITATION: Imitation = {
  readMin: 10,
  readMax: 40,
  distractMin: 5,
  distractMax: 55,
  fastEvery: 12,
  fastMin: 1,
  fastMax: 4,
};

export type Account = Stored & {
  balance: number;
  history: Charge[];
  imitation: Imitation;
  weekAt: number;
  weekMinutes: number;
  weekClicks: number;
  weekDevices: Record<string, number>;
  feedChannel: string;
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
  hhHours: '1',
  extToken: '',
  telegramLabel: '',
  hhLabel: '',
  coverLetter: '',
  balance: 0,
  history: [],
  imitation: { ...IMITATION },
  weekAt: 0,
  weekMinutes: 0,
  weekClicks: 0,
  weekDevices: {},
  feedChannel: '',
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
    hhHours: raw.hhHours === '0' ? '0' : '1',
    balance: typeof raw.balance === 'number' ? raw.balance : 0,
    history: chargesOf(raw.history),
    imitation: imitationOf(raw.imitation),
    weekAt: atLeastZero(raw.weekAt),
    weekMinutes: atLeastZero(raw.weekMinutes),
    weekClicks: atLeastZero(raw.weekClicks),
    weekDevices: devicesOf(raw.weekDevices),
    feedChannel: channelName(typeof raw.feedChannel === 'string' ? raw.feedChannel : '') ?? '',
  };
  if (parsed.salvaged) {
    console.error(`account ${login}: восстановил из битого файла, перезаписал`);
    await writeAccount(login, account);
  }

  return account;
}

export async function writeAccount(login: string, next: Account): Promise<void> {
  await writeJsonAtomic(accountPath(login), next);
  await rememberToken(login, next.extToken);
}

export async function ensureAccount(login: string): Promise<Account> {
  const safe = safeLogin(login);
  if (await accountFileStat(safe) === null) {
    const created = empty();
    created.extToken = newExtToken();
    await writeAccount(safe, created);
  }

  return readAccount(safe);
}

export async function listLogins(): Promise<string[]> {
  try {
    const names = await fsPromises.readdir(path.join(rootDir(), 'accounts'));
    return names.flatMap(name => name.endsWith('.json') ? [name.slice(0, -5)] : []).filter(name => /^[A-Za-z0-9-]{1,39}$/.test(name));
  }
  catch {
    return [];
  }
}

export async function loginForToken(given: string): Promise<string | null> {
  if (given.length === 0)
    return null;

  const index = await readTokenIndex();
  const hinted = index[given];
  if (typeof hinted === 'string' && await tokenMatches(hinted, given))
    return hinted;

  const logins = await listLogins();
  for (const login of logins) {
    if (await tokenMatches(login, given)) {
      await rememberToken(login, given);
      return login;
    }
  }

  return null;
}

export type AtsScan = {
  score: number;
  flags: AtsFlag[];
  via: string;
  at: number;
  letter: string;
  resumeAt: number;
  outdated: boolean;
};

function atsPath(login: string): string {
  return path.join(rootDir(), 'accounts', `${safeLogin(login)}.ats.json`);
}

export async function readAtsScan(login: string): Promise<AtsScan | null> {
  let text: string;
  try {
    text = await fsPromises.readFile(atsPath(login), 'utf8');
  }
  catch {
    return null;
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null)
    return null;

  return atsScanOf(parsed.value);
}

export async function writeAtsScan(login: string, scan: Omit<AtsScan, 'outdated'>): Promise<void> {
  await writeJsonAtomic(atsPath(login), scan);
}

export type SavedResume = {
  id: string;
  text: string;
  at: number;
};

function resumePath(login: string): string {
  return path.join(rootDir(), 'accounts', `${safeLogin(login)}.resume.json`);
}

export async function readResume(login: string): Promise<SavedResume | null> {
  let text: string;
  try {
    text = await fsPromises.readFile(resumePath(login), 'utf8');
  }
  catch {
    return null;
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null)
    return null;

  return resumeOf(parsed.value);
}

export async function writeResume(login: string, resume: SavedResume): Promise<void> {
  await writeJsonAtomic(resumePath(login), resume);
}

function resumeOf(value: unknown): SavedResume | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Partial<SavedResume>;
  if (typeof row.id !== 'string' || /^[A-Za-z0-9]{8,}$/.test(row.id) === false)
    return null;
  if (typeof row.text !== 'string')
    return null;

  const text = row.text.replace(/\r\n/g, '\n').trim();
  if (text.length < 80)
    return null;
  if (typeof row.at !== 'number' || Number.isFinite(row.at) === false)
    return null;

  return { id: row.id, text, at: row.at };
}

function atsScanOf(value: unknown): AtsScan | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Partial<AtsScan>;
  if (typeof row.score !== 'number' || Number.isInteger(row.score) === false || row.score < 0 || row.score > 100)
    return null;
  if (typeof row.via !== 'string' || row.via.trim().length === 0 || row.via.length > 40)
    return null;
  if (typeof row.at !== 'number' || Number.isFinite(row.at) === false)
    return null;
  if (typeof row.letter !== 'string')
    return null;
  const flags = asAtsFlags(row.flags);
  const outdated = flags.length < 6;
  const resumeAt = typeof row.resumeAt === 'number' && Number.isFinite(row.resumeAt) ? row.resumeAt : 0;

  return {
    score: row.score,
    flags: outdated ? [] : flags,
    via: row.via.trim(),
    at: row.at,
    letter: row.letter,
    resumeAt,
    outdated,
  };
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
  hhHours: 'HH_HOURS',
  extToken: 'EXT_TOKEN',
};

export { DEFAULT_QUERY } from '@cursor-chrome/hh';

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

const SEC_MAX = 600;
const EVERY_MAX = 100;

const RANGES = [
  ['readMin', 'readMax', 'чтение'],
  ['distractMin', 'distractMax', 'после отклика'],
  ['fastMin', 'fastMax', 'быстрая'],
] as const;

const EVERIES = [
  ['fastEvery', 'быстрая'],
] as const;

export function imitationOf(value: unknown): Imitation {
  const row = typeof value === 'object' && value !== null ? value as Partial<Imitation> : {};
  const pace: Imitation = { ...IMITATION };
  for (const [minKey, maxKey] of RANGES) {
    const min = whole(row[minKey], 0, SEC_MAX);
    const max = whole(row[maxKey], 0, SEC_MAX);
    if (min === null || max === null)
      continue;

    pace[minKey] = Math.min(min, max);
    pace[maxKey] = Math.max(min, max);
  }
  for (const [key] of EVERIES) {
    const every = whole(row[key], 1, EVERY_MAX);
    if (every !== null)
      pace[key] = every;
  }

  return pace;
}

export function imitationFromFields(fields: Record<string, string>): { ok: true; pace: Imitation } | { ok: false; detail: string } {
  const pace: Imitation = { ...IMITATION };
  for (const [minKey, maxKey, label] of RANGES) {
    const min = takeSec(fields[minKey] ?? '', label);
    if (min.ok === false)
      return min;

    const max = takeSec(fields[maxKey] ?? '', label);
    if (max.ok === false)
      return max;

    pace[minKey] = Math.min(min.n, max.n);
    pace[maxKey] = Math.max(min.n, max.n);
  }
  for (const [key, label] of EVERIES) {
    const every = takeEvery(fields[key] ?? '', label);
    if (every.ok === false)
      return every;

    pace[key] = every.n;
  }

  return { ok: true, pace };
}

function takeSec(raw: string, label: string): { ok: true; n: number } | { ok: false; detail: string } {
  const text = raw.trim();
  if (/^\d+$/.test(text) === false)
    return { ok: false, detail: `${label}: нужны целые секунды` };

  const n = Number(text);
  if (n > SEC_MAX)
    return { ok: false, detail: `${label}: больше 600 секунд` };

  return { ok: true, n };
}

function takeEvery(raw: string, label: string): { ok: true; n: number } | { ok: false; detail: string } {
  const text = raw.trim();
  if (/^\d+$/.test(text) === false)
    return { ok: false, detail: `${label}: нужно целое число вакансий` };

  const n = Number(text);
  if (n < 1 || n > EVERY_MAX)
    return { ok: false, detail: `${label}: раз на вакансий — от 1 до 100` };

  return { ok: true, n };
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || Number.isInteger(value) === false)
    return null;

  if (value < min || value > max)
    return null;

  return value;
}

function atLeastZero(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false || value < 0)
    return 0;

  return value;
}

function devicesOf(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null)
    return {};

  const out: Record<string, number> = {};
  for (const [key, stamp] of Object.entries(value)) {
    if (/^[A-Za-z0-9-]{8,80}$/.test(key) === false)
      continue;

    const at = atLeastZero(stamp);
    if (at > 0)
      out[key] = at;
  }

  return out;
}

function tokenIndexPath(): string {
  return path.join(rootDir(), 'ext-tokens.json');
}

async function readTokenIndex(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(tokenIndexPath(), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null)
      return {};

    return parsed as Record<string, string>;
  }
  catch {
    return {};
  }
}

async function rememberToken(login: string, token: string): Promise<void> {
  const index = await readTokenIndex();
  for (const [saved, owner] of Object.entries(index)) {
    if (owner === login && saved !== token)
      delete index[saved];
  }

  if (token.length > 0)
    index[token] = login;

  await writeJsonAtomic(tokenIndexPath(), index);
}

async function tokenMatches(login: string, given: string): Promise<boolean> {
  const saved = (await readAccount(login)).extToken;
  if (saved.length === 0 || saved.length !== given.length)
    return false;

  return crypto.timingSafeEqual(Buffer.from(saved), Buffer.from(given));
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
  account.history = [{
    at: Date.now(),
    company: item.company,
    url: item.url,
    rub: 0,
  }, ...account.history].slice(0, 80);
  await writeAccount(login, account);

  return true;
}

import { storePath } from './memory.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type State = {
  auto: boolean;
  lastScanAt: number;
  lastNote: string;
};

const EMPTY: State = { auto: false, lastScanAt: 0, lastNote: '' };

export function statePath(): string {
  return path.join(path.dirname(storePath()), 'state.json');
}

export async function readState(): Promise<State> {
  let text: string;
  try {
    text = await fsPromises.readFile(statePath(), 'utf8');
  }
  catch {
    return EMPTY;
  }

  const parsed = parseJsonLoose(text);
  if (parsed === null || typeof parsed.value !== 'object' || parsed.value === null)
    return EMPTY;

  const raw = parsed.value as Partial<State>;

  return {
    auto: raw.auto === true,
    lastScanAt: typeof raw.lastScanAt === 'number' ? raw.lastScanAt : 0,
    lastNote: typeof raw.lastNote === 'string' ? raw.lastNote : '',
  };
}

export async function writeState(patch: Partial<State>): Promise<State> {
  const next = { ...await readState(), ...patch };
  await writeJsonAtomic(statePath(), next);

  return next;
}

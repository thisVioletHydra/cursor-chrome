import { moscowDay, storePath } from './memory.ts';
import { parseJsonLoose, writeJsonAtomic } from './store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type State = {
  auto: boolean;
  lastScanAt: number;
  lastNote: string;
  hung: boolean;
  frontAt: number;
  lessAt: number;
  queryPass: number;
  runAt: number;
  walkPhase: 'cover' | 'deep';
  walkAt: number;
  walkLeft: number;
  walkDay: string;
};

const EMPTY: State = {
  auto: false,
  lastScanAt: 0,
  lastNote: '',
  hung: false,
  frontAt: 0,
  lessAt: 0,
  queryPass: -1,
  runAt: 0,
  walkPhase: 'cover',
  walkAt: 0,
  walkLeft: 1,
  walkDay: '',
};

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
    hung: raw.hung === true,
    frontAt: atOf(raw.frontAt),
    lessAt: atOf(raw.lessAt),
    queryPass: typeof raw.queryPass === 'number' && Number.isFinite(raw.queryPass) ? raw.queryPass : -1,
    runAt: atOf(raw.runAt),
    walkPhase: raw.walkPhase === 'deep' ? 'deep' : 'cover',
    walkAt: atOf(raw.walkAt),
    walkLeft: atOf(raw.walkLeft),
    walkDay: typeof raw.walkDay === 'string' ? raw.walkDay : '',
  };
}

function atOf(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false || value < 0)
    return 0;

  return Math.floor(value);
}

export async function writeState(patch: Partial<State>): Promise<State> {
  const prev = await readState();
  const next = { ...prev, ...patch, runAt: prev.runAt };
  if (patch.auto === true)
    next.hung = false;

  if (patch.auto === false)
    next.runAt = 0;
  else if (patch.auto === true && (prev.auto === false || prev.runAt === 0)) {
    next.runAt = Date.now();
    next.walkPhase = 'cover';
    next.walkAt = 0;
    next.walkLeft = 1;
    next.walkDay = moscowDay();
  }

  await writeJsonAtomic(statePath(), next);

  return next;
}

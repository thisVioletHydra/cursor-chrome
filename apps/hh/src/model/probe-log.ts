import { storePath } from '../diary/memory.ts';
import { writeJsonAtomic } from '../diary/store.ts';

import fsPromises from 'node:fs/promises';
import path from 'node:path';

export type ProbeNote = {
  at: string;
  name: string;
  model: string;
  ok: boolean;
  status: number;
  detail: string;
};

const MAX_NOTES = 80;

export function probeLogPath(): string {
  return path.join(path.dirname(storePath()), 'probes.json');
}

let tail: Promise<void> = Promise.resolve();

export function noteProbe(row: ProbeNote): void {
  tail = tail.then(() => appendProbe(row)).catch(() => undefined);
}

export async function readProbeLog(): Promise<ProbeNote[]> {
  try {
    const text = await fsPromises.readFile(probeLogPath(), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) === false)
      return [];

    return parsed.flatMap(item => (asNote(item) ? [asNote(item) as ProbeNote] : []));
  }
  catch {
    return [];
  }
}

async function appendProbe(row: ProbeNote): Promise<void> {
  const notes = await readProbeLog();
  notes.push(trimNote(row));
  await writeJsonAtomic(probeLogPath(), notes.slice(-MAX_NOTES));
}

function trimNote(row: ProbeNote): ProbeNote {
  return {
    at: row.at,
    name: row.name.slice(0, 40),
    model: row.model.slice(0, 80),
    ok: row.ok === true,
    status: Number.isFinite(row.status) ? row.status : 0,
    detail: row.detail.replace(/\s+/g, ' ').trim().slice(0, 160),
  };
}

function asNote(value: unknown): ProbeNote | null {
  if (typeof value !== 'object' || value === null)
    return null;

  const row = value as Record<string, unknown>;
  if (typeof row.model !== 'string' || typeof row.detail !== 'string')
    return null;

  return {
    at: typeof row.at === 'string' ? row.at : '',
    name: typeof row.name === 'string' ? row.name : '',
    model: row.model,
    ok: row.ok === true,
    status: typeof row.status === 'number' ? row.status : 0,
    detail: row.detail,
  };
}

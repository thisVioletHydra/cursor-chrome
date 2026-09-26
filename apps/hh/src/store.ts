import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fsPromises.writeFile(tmp, JSON.stringify(value));
  await fsPromises.rename(tmp, file);
}

export function parseJsonLoose(text: string): { value: unknown; salvaged: boolean } | null {
  try {
    return { value: JSON.parse(text), salvaged: false };
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const at = Number(message.match(/position (\d+)/)?.[1]);
    if (Number.isFinite(at) === false || at < 2)
      return null;

    try {
      return { value: JSON.parse(text.slice(0, at)), salvaged: true };
    }
    catch {
      return null;
    }
  }
}

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

let cached = '';

export async function extensionBuild(): Promise<string> {
  if (cached.length > 0)
    return cached;

  const files = [path.resolve(process.cwd(), 'package.json'), path.resolve(process.cwd(), '../../package.json')];
  for (const file of files) {
    const version = await versionOf(file);
    if (version.length > 0) {
      cached = version;

      return version;
    }
  }

  return '';
}

async function versionOf(file: string): Promise<string> {
  try {
    const raw = JSON.parse(await fsPromises.readFile(file, 'utf8')) as { name?: unknown; version?: unknown };
    if (raw.name === 'cursor-chrome' && typeof raw.version === 'string')
      return raw.version;
  }
  catch {
    return '';
  }

  return '';
}

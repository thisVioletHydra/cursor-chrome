import buffer from 'node:buffer';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '../..');

await main();

async function main() {
  const manifest = JSON.parse(await fsPromises.readFile(path.join(repo, 'apps/extension/src/manifest.json'), 'utf8'));
  const key = manifest.key;
  if (typeof key !== 'string' || key.length === 0)
    throw new Error('apps/extension/src/manifest.json is missing key');

  const id = extensionId(key);
  const hostName = 'com.cursor.chrome';
  const hostPath = path.join(root, 'run-host.sh');
  await fsPromises.chmod(hostPath, 0o755);
  await fsPromises.writeFile(path.join(root, 'node.path'), `${await stableNode()}\n`);

  const hostManifest = {
    name: hostName,
    description: 'Cursor Chrome native messaging host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
  const body = `${JSON.stringify(hostManifest, null, 2)}\n`;

  const dirs = [
    path.join(os.homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
    path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
  ];

  for (const dir of dirs) {
    await fsPromises.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${hostName}.json`);
    await fsPromises.writeFile(dest, body);
    console.error(`wrote ${dest}`);
  }

  console.error(`extension id ${id}`);
  console.error('reload unpacked apps/extension/dist in Edge after this');
}

async function stableNode() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Library/pnpm/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const candidate of candidates) {
    if (await existsExecutable(candidate))
      return candidate;
  }

  return process.execPath;
}

async function existsExecutable(candidate) {
  try {
    await fsPromises.access(candidate, fsPromises.constants.X_OK);

    return true;
  }
  catch {
    return false;
  }
}

function extensionId(publicKey) {
  const der = buffer.Buffer.from(publicKey, 'base64');
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);

  return [...hex].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
}

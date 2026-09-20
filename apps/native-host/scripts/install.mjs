import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const manifest = JSON.parse(readFileSync(join(repo, 'apps/extension/src/manifest.json'), 'utf8'));
const key = manifest.key;
if (!key || typeof key !== 'string')
  throw new Error('apps/extension/src/manifest.json is missing key');

const id = extensionId(key);
const hostName = 'com.cursor.chrome';
const hostPath = join(root, 'run-host.sh');
chmodSync(hostPath, 0o755);
writeFileSync(join(root, 'node.path'), `${stableNode()}\n`);

const hostManifest = {
  name: hostName,
  description: 'Cursor Chrome native messaging host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${id}/`],
};
const body = `${JSON.stringify(hostManifest, null, 2)}\n`;

const dirs = [
  join(homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
  join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
];

for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${hostName}.json`);
  writeFileSync(dest, body);
  console.error(`wrote ${dest}`);
}

console.error(`extension id ${id}`);
console.error('reload unpacked apps/extension/dist in Edge after this');

function stableNode() {
  const home = homedir();
  const candidates = [
    join(home, 'Library/pnpm/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    }
    catch {
      // hashed store / volta / nvm paths rot; skip
    }
  }
  return process.execPath;
}

function extensionId(publicKey) {
  const der = Buffer.from(publicKey, 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
}

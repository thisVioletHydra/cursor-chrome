import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '../..');
const dist = join(root, 'dist');
const src = join(root, 'src');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;

mkdirSync(join(dist, 'icons'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
manifest.version = version;
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ['offscreen.html', 'popup.html', 'popup.css'])
  copyFileSync(join(src, file), join(dist, file));

for (const file of readdirSync(join(src, 'icons'))) {
  if (!file.endsWith('.png'))
    continue;
  copyFileSync(join(src, 'icons', file), join(dist, 'icons', file));
}

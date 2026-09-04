import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const src = join(root, 'src');

mkdirSync(join(dist, 'icons'), { recursive: true });

for (const file of ['manifest.json', 'offscreen.html', 'popup.html', 'popup.css'])
  copyFileSync(join(src, file), join(dist, file));

for (const file of readdirSync(join(src, 'icons'))) {
  if (!file.endsWith('.png'))
    continue;
  copyFileSync(join(src, 'icons', file), join(dist, 'icons', file));
}

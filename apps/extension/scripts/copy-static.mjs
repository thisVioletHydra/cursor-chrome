import { createHash } from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '../..');
const dist = path.join(root, 'dist');
const src = path.join(root, 'src');

await main();

async function main() {
  const version = JSON.parse(await fsPromises.readFile(path.join(repo, 'package.json'), 'utf8')).version;
  await fsPromises.mkdir(path.join(dist, 'icons'), { recursive: true });

  const manifest = JSON.parse(await fsPromises.readFile(path.join(src, 'manifest.json'), 'utf8'));
  manifest.version = version;
  await fsPromises.writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of ['offscreen.html', 'popup.html', 'popup.css', 'options.html', 'options.css'])
    await fsPromises.copyFile(path.join(src, file), path.join(dist, file));

  const hash = createHash('sha256');
  const files = (await fsPromises.readdir(dist)).sort();
  for (const file of files) {
    if (!/\.(js|css|html|json)$/.test(file))
      continue;

    hash.update(file);
    hash.update(await fsPromises.readFile(path.join(dist, file)));
  }

  const popupPath = path.join(dist, 'popup.html');
  const popup = await fsPromises.readFile(popupPath, 'utf8');
  await fsPromises.writeFile(popupPath, popup.replace('__BUILD_HASH__', hash.digest('hex').slice(0, 8)));

  for (const file of await fsPromises.readdir(path.join(src, 'icons'))) {
    if (file.endsWith('.png') === false)
      continue;

    await fsPromises.copyFile(path.join(src, 'icons', file), path.join(dist, 'icons', file));
  }
}

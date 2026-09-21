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

  for (const file of ['offscreen.html', 'popup.html', 'popup.css'])
    await fsPromises.copyFile(path.join(src, file), path.join(dist, file));

  for (const file of await fsPromises.readdir(path.join(src, 'icons'))) {
    if (file.endsWith('.png') === false)
      continue;

    await fsPromises.copyFile(path.join(src, 'icons', file), path.join(dist, 'icons', file));
  }
}

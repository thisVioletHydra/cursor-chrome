import { defineConfig } from 'tsdown';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const version = JSON.parse(
  await fsPromises.readFile(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../../package.json'),
    'utf8',
  ),
).version as string;

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  noExternal: ['@cursor-chrome/protocol'],
  outExtensions: () => ({ js: '.js' }),
});

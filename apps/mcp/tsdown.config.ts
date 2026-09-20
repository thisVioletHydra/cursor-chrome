import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const version = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
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

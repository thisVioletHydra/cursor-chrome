import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: ['@cursor-chrome/protocol'],
  outExtensions: () => ({ js: '.js' }),
});

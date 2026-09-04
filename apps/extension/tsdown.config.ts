import { defineConfig } from 'tsdown';

const shared = {
  format: 'iife' as const,
  platform: 'browser' as const,
  target: 'chrome120',
  outDir: 'dist',
  clean: false,
  noExternal: ['@cursor-chrome/protocol'],
  outExtensions: () => ({ js: '.js' }),
  outputOptions: {
    entryFileNames: '[name].js',
  },
};

export default defineConfig([
  { ...shared, entry: { background: 'src/background.ts' } },
  { ...shared, entry: { offscreen: 'src/offscreen.ts' } },
  { ...shared, entry: { popup: 'src/popup.ts' } },
  { ...shared, entry: { content: 'src/content.ts' } },
]);

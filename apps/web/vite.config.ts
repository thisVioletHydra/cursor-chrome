import childProcess from 'node:child_process';
import process from 'node:process';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import tailwindcss from '@tailwindcss/vite';

let builtSha = process.env.RAILWAY_GIT_COMMIT_SHA || '';
try { builtSha ||= childProcess.execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}

export default defineConfig({
  define: { __GIT_SHORT__: JSON.stringify(builtSha) },
  plugins: [tailwindcss(), sveltekit()],
  ssr: {
    external: ['ws'],
    noExternal: ['@cursor-chrome/telegram', '@cursor-chrome/hh'],
  },
});

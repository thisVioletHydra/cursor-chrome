import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  ssr: {
    external: ['ws'],
    noExternal: ['@cursor-chrome/telegram', '@cursor-chrome/hh'],
  },
});

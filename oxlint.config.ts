import { defineConfig } from 'oxlint';

import oxyhub from '@oxyhub/oxlint-plugin/config';

export default defineConfig({
  extends: [oxyhub],
  ignorePatterns: [
    'dist/**',
    'node_modules/**',
  ],
});

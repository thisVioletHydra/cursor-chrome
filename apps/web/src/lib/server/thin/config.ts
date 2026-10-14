// GET /api/config: what the thin extension may change without a release (hh selectors, dictionaries, rule order).
import crypto from 'node:crypto';

import { ORDER } from './answer-engine.ts';

export const CONFIG = {
  version: 2,
  selectors: {
    taskQuestion: '[data-qa="task-question"]',
    letterToggle: '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"]',
    letterField: 'textarea[data-qa*="letter"], [data-qa*="letter"] textarea',
    applyButton: '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]',
    submitButton: '[data-qa="vacancy-response-submit-popup"]',
    xaiLogin: 'a[href*="sign-in"], a[href*="login"], button[data-provider="google"], [data-testid*="sign-in"]',
    xaiApiKeys: 'a[href*="/api-keys"]',
    xaiCreateKey: '[data-testid*="create-api-key"], button[aria-label*="Create API key" i]',
    xaiCopyKey: '[data-testid*="copy"], button[aria-label*="Copy" i]',
  },
  dictionaries: {
    skillJunk: ['php', 'bitrix', 'битрикс', '1с', '1c', 'react native'],
  },
  order: [...ORDER],
};

export function configBody(config = CONFIG): { text: string; etag: string } {
  const text = JSON.stringify(config);

  return { text, etag: `"cfg-${config.version}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}"` };
}

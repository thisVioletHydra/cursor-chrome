import { applyMeta } from './apply-watch';
import { visible } from './dom';
import { applyRoot, reviewHints } from './screen-questions';

export type ApplyBlock = {
  reason: string;
  hints: string[];
};

const CAPTCHA_COPY = /captcha|recaptcha|hcaptcha|smartcaptcha|я не робот/i;

const REASON: Record<string, string> = {
  'гугл-форма / тест': 'гугл-форма / тест',
  'капча': 'капча',
};

export function applyBlocker(): ApplyBlock | null {
  const checks = [hintBlock, captchaBlock];
  for (const check of checks) {
    const hit = check();
    if (hit)
      return hit;
  }

  return null;
}

export function formReady(): boolean {
  return applyRoot() !== null;
}

export function humanPayload(block: ApplyBlock): {
  reason: string;
  hints: string[];
  title: string;
  company: string;
  url: string;
  vacancyId: string;
} {
  return { ...applyMeta(), ...block };
}

function hintBlock(): ApplyBlock | null {
  const hints = reviewHints();
  if (hints.length === 0)
    return null;

  return { reason: REASON[hints[0] || ''] || 'свои вопросы HH', hints: hints.slice(0, 8) };
}

function captchaBlock(): ApplyBlock | null {
  const widget = document.querySelector<HTMLElement>('[class*="captcha"], [id*="captcha"], iframe[src*="captcha"]');
  const shown = widget instanceof HTMLElement ? visible(widget) : Boolean(widget);
  if (shown === false || CAPTCHA_COPY.test(document.body.innerText || '') === false)
    return null;

  return { reason: 'капча', hints: ['капча'] };
}

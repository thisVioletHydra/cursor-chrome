import type { CapturedForm } from './form-capture';

import { applyMeta } from './apply-watch';
import { hhCaptchaShown } from './captcha';
import { captureForm } from './form-capture';
import { applyRoot, employerQuestionnaire, reviewHints } from './screen-questions';

export type ApplyBlock = {
  reason: string;
  hints: string[];
  form?: CapturedForm;
};

const REASON: Record<string, string> = {
  'гугл-форма / тест': 'гугл-форма / тест',
  'капча': 'капча',
};

export function captchaOnPage(): ApplyBlock | null {
  if (hhCaptchaShown() === false)
    return null;

  return { reason: 'капча', hints: ['капча'] };
}

export function applyBlocker(): ApplyBlock | null {
  const checks = [captchaOnPage, employerQuestionnaire, hintBlock];
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

  const root = applyRoot();
  const form = root ? captureForm(root) : null;

  return { reason: REASON[hints[0] || ''] || 'свои вопросы площадки', hints: hints.slice(0, 8), ...(form ? { form } : {}) };
}


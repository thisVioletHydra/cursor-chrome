// Standard hh screening answers (city / pay / citizenship) come from the user's profile, never from code.
// No value in the profile → '' → the caller stops with «нужен твой ответ».
import type { Profile, VacancyFacts } from '../../../hh/src/review/profile.ts';

import { evaluateRule } from '../../../hh/src/review/profile.ts';

export type StandardKind = 'city' | 'pay' | 'citizen';

const FIELD: Record<StandardKind, string[]> = { city: ['city'], pay: ['salary'], citizen: ['citizenship'] };

export function standardValue(kind: StandardKind, profile: Profile | null, vacancy: VacancyFacts = {}): string {
  if (profile === null)
    return '';

  for (const field of FIELD[kind]) {
    const value = evaluateRule(profile.fields[field], vacancy).trim();
    if (value)
      return value;
  }

  return '';
}

// Match an option by the first word of the value (stem of 5 letters): «Тестоград» ~ «Тестоградская обл.».
export function valueRe(value: string): RegExp {
  const word = value.trim().split(/[\s,.;]+/)[0] ?? '';
  const stem = word.length > 5 ? word.slice(0, 5) : word;

  return new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

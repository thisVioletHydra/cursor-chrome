// Extra scenarios ported (read-only) from extension: murky.ts, resume.ts, job-offer.ts, hide-dom.ts,
// queue-run TEST/week/day, negotiations invitations. Each one is behind its own settings flag (default off).
import type { Settings } from './types.ts';

export type Scenario = 'savedLinks' | 'relook' | 'resumePick' | 'letter' | 'murky' | 'testTask' | 'jobOffer' | 'hideJunk' | 'invites' | 'inviteAutoReply' | 'quota';
// Additive view over Settings: settings(login) may return { scenarios: { letter: true, ... } }.
export type PlanSettings = Settings & { scenarios?: Partial<Record<Scenario, boolean>> };
export const on = (set: Settings, s: Scenario) => (set as PlanSettings).scenarios?.[s] === true;

const MURKY: Array<[RegExp, string]> = [
  [/шарад/i, 'шарады'], [/ребус/i, 'ребусы'], [/головолом/i, 'головоломки'], [/цыганщин/i, 'цыганщина'], [/загадк/i, 'загадки'],
  [/\bpuzzle\b/i, 'puzzle'], [/\briddle\b/i, 'riddle'], [/кодовое слово/i, 'кодовое слово'], [/если[^.]{0,48}дочитал/i, 'если дочитал'], [/прочита(?:йте|л) до конца/i, 'прочитайте до конца'],
];
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
export function murkyBlock(html: string): string {
  const hit = MURKY.find(([re]) => re.test(plain(html)));
  return hit ? `цыганщина: ${hit[1]}` : '';
}

const TEST_TASK = /тестов(?:ое|ого) задани|employer-asking-for-test|выполните тест/i;
export const testTask = (html: string) => TEST_TASK.test(html);

export const JOB_OFFER = /приняли предложение о работе/i;
export const JOB_OFFER_CLOSE = 'button[data-qa="banner-close"]';

// hh/resume.ts resumeKind
const BACKEND_TITLE = /fullstack|full[\s-]?stack|фул+стек|backend|бэкенд|бекенд|back[\s-]?end|\bnode(?:\.?js)?\b/i;
const FRONT_TITLE = /frontend|front[\s-]?end|фронтенд|\bvue\b|\breact\b/i;
export type ResumeKind = 'frontend' | 'fullstack';
export function resumeKind(title: string, body = ''): ResumeKind {
  const text = title.trim() || body;
  return !FRONT_TITLE.test(text) && BACKEND_TITLE.test(text) ? 'fullstack' : 'frontend';
}

// hide-dom.ts: card-scoped «Скрыть» button (Chrome supports :has).
export const hideSelector = (id: string) => `[data-qa="vacancy-serp__vacancy"]:has(a[href*="/vacancy/${id}"]) button[aria-label="Скрыть"], [data-qa="vacancy-serp__vacancy"]:has(a[href*="/vacancy/${id}"]) button[data-qa="vacancy__blacklist-show-add_narrow-card"]`;

// next 09:00 MSK on Monday
export function msToMonday(now: number): number {
  const msk = new Date(now + 3 * 3600_000);
  const days = (8 - msk.getUTCDay()) % 7 || 7;
  const target = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + days, 9) - 3 * 3600_000;
  return target - now;
}

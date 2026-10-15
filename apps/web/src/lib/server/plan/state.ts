// Per-account planner state + the per-account feature flag. In memory only (Railway: no workers);
// contains vacancy ids/titles and counters, no personal data. A restart just resets to "start".
import type { Item } from './types.ts';

export type Phase = 'start' | 'serp_open' | 'serp_read' | 'neg_open' | 'neg_read' | 'vac_open' | 'vac_read' | 'vac_offer' | 'hide' | 'vac_wait' | 'apply_click' | 'form_wait' | 'page_check' | 'form_read' | 'apply' | 'after';

export interface Hold { reason: string; needsHuman: boolean; at: number }

export interface PlanState {
  login: string;
  phase: Phase;
  queue: Item[];
  current: Item | null;
  answers: unknown[];
  page: number;
  wordIdx: number;
  
  sentToday: number;
  day: string;
  workSince: number; // start of current work stretch (tea clock)
  teaAt: number;
  negotiationsAt: number;
  hold: Hold | null;
  mode: 'feed' | 'words' | 'light';
  dryStreak: number;
  lightLeft: number; // light: 10 cards then 1 h sleep
  lightBare: boolean; // light pass had nothing on-stack → sleep another hour
  sleepUntil: number;
  hideQueue: Item[];
  invitesSeen: string[];
  linksAt: number;
  relookLeft: number;
  quotaAt: number;
  quietUntil: number; // admin day/week quota stop
  seen: string[]; // vacancy ids handled in this process (ids only, capped) → no re-queue
  log: string[]; // markers like 'apply:verify' (post-timeout check)
}

export function freshState(login: string, now: number): PlanState {
  return { login, phase: 'start', queue: [], current: null, answers: [], page: 0, wordIdx: 0, sentToday: 0, day: dayOf(now), workSince: now, teaAt: now, negotiationsAt: 0, hold: null, log: [], mode: 'feed', dryStreak: 0, lightLeft: 0, lightBare: true, sleepUntil: 0, seen: [], hideQueue: [], invitesSeen: [], linksAt: 0, relookLeft: 8, quotaAt: 0, quietUntil: 0 };
}

export const dayOf = (now: number) => new Date(now + 3 * 3600_000).toISOString().slice(0, 10); // MSK day

export function createStore() {
  const states = new Map<string, PlanState>();
  const flags = new Map<string, boolean>();
  return {
    get(login: string, now: number): PlanState {
      let s = states.get(login);
      if (!s) { s = freshState(login, now); states.set(login, s); }
      return s;
    },
    reset(login: string) { states.delete(login); },
    // Flag: new server-side logic for this account. Off by default → old extension logic keeps running.
    enabled: (login: string) => flags.get(login) === true,
    setEnabled(login: string, on: boolean) { flags.set(login, on); if (!on) states.delete(login); },
    // New extension run (x-ext-run): lift the hold. A vacancy in progress is re-opened and verified, never
    // re-applied blindly: from 'apply' on, apply:verify is set so vac_read sends needsHuman unless hh shows «откликнулись».
    rearm: (login: string) => {
      const s = states.get(login);
      if (s === undefined)
        return;

      s.hold = null;
      if (s.current === null) {
        s.phase = 'start';

        return;
      }

      if ((s.phase === 'apply' || s.phase === 'after') && s.log.includes('apply:verify') === false)
        s.log.push('apply:verify');
      if (s.phase !== 'after')
        s.phase = 'vac_open';
    },
    // Human solved captcha / checked SMS → resume.
    release(login: string) { const s = states.get(login); if (s) { s.hold = null; s.phase = 'start'; } },
  };
}
export type Store = ReturnType<typeof createStore>;

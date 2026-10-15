// Contract with stage B transport (thin/cmd-bus.ts): Cmd = { kind, params }, Outcome = { ok, result? , error? }.
import type { NegotiationRow } from './negotiations.ts';

export type Kind = 'readDOM' | 'navigate' | 'click' | 'type' | 'select' | 'press_key' | 'read' | 'snapshot' | 'wait' | 'hh_apply';
export interface Cmd { kind: Kind; params: Record<string, unknown> }
export type Outcome = { ok: true; result?: unknown } | { ok: false; error: string };
export type Enqueue = (login: string, cmd: Cmd, opts?: { execMs?: number }) => Promise<Outcome>;

// One answer for a form field (from /api/answer). human: true → needs a person (empty required / no matching option).
export interface Answer { id: string; answer?: string; value?: unknown; human?: boolean; reason?: string }

export interface Item { id: string; title: string; url: string; company?: string }
export type Status = 'sent' | 'needsHuman' | 'skip';

// Everything the planner needs from the rest of the server. All injected → tests use fakes.
// Personal data (resume, memory, rules, LLM key) is never kept here: context()/answer() are transit calls.
export interface Deps {
  enqueue: Enqueue;
  now?: () => number;
  rand?: () => number;
  // existing /api/answer engine; context is fetched per call (transit from the extension).
  answer?: (login: string, body: { fields: unknown[]; context: unknown }) => Promise<{ answers: Answer[] }>;
  context?: (login: string) => Promise<unknown>;
  // existing /api/applied, /api/found, seen
  recordApplied?: (login: string, row: { id: string; url: string; title: string; status: Status; reason: string }) => Promise<void>;
  filterKnown?: (login: string, cards: Item[]) => Promise<Item[]>;
  onNegotiations?: (login: string, html: string) => Promise<void>;
  // parsed rows of the negotiations page (see plan/negotiations.ts)
  onNegotiationRows?: (login: string, rows: NegotiationRow[]) => Promise<void>;
  // stage C extras (all optional; each also needs its settings.scenarios flag):
  fetchLinks?: (login: string) => Promise<Item[]>; // saved links from admin (/api/queue links)
  claimRelook?: (login: string) => Promise<Item[]>; // hidden vacancies to look at again
  coverLetter?: (login: string) => Promise<string>; // transit from the extension safe, never stored
  postHidden?: (login: string, row: { id: string; title: string; reason: string }) => Promise<void>;
  onInvitation?: (login: string, row: NegotiationRow) => Promise<void>; // new invitation seen
  quota?: (login: string) => Promise<{ day: boolean; week: boolean }>; // admin hunt.day / hunt.week
  // per-account settings coming from admin (pace, keepWorkHours, query words)
  reviewItems?: (login:string)=>Promise<Item[]>;
  reviewAnswers?: (login:string,id:string)=>Promise<Array<{prompt:string;answer:string}>>;
  captureForm?: (login:string,item:Item,fields:unknown[],text:string)=>Promise<void>;
  settings?: (login: string) => Promise<Settings>;
}

export type Scenario = 'savedLinks' | 'relook' | 'resumePick' | 'letter' | 'murky' | 'testTask' | 'jobOffer' | 'hideJunk' | 'invites' | 'inviteAutoReply' | 'quota';

export interface Settings { scenarios?: Partial<Record<Scenario, boolean>>; pace?: unknown; keepWorkHours?: boolean; words?: string[]; feed?: 'feed' | 'light'; maxPages?: number; dailyCap?: number }

export type Step =
  | { type: 'cmd'; cmd: Cmd; execMs?: number }
  | { type: 'idle'; reason: string; retryMs: number }
  | { type: 'stop'; reason: string; needsHuman: boolean };

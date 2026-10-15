// Planner deps on top of EXISTING apps/web + @cursor-chrome/hh storage, injected as arguments (no imports of
// DB code here → testable with fakes, no migrations). Mirrors /api/queue (links, relook, hidden), /api/negotiations
// and the day/week gate of GET /api/queue. Every call runs inside io.inTenant(login, …) → account isolation.
import type { Deps, Item } from './types.ts';
import type { NegotiationRow } from './negotiations.ts';

export interface QueueRow { id: string; status: string }
export interface StoreIO {
  inTenant: <T>(login: string, job: () => Promise<T>) => Promise<T>; // runTenant from @cursor-chrome/hh
  readLinks: (limit: number) => Promise<{ id: string; url: string; title: string }[]>;
  readQueue: () => Promise<QueueRow[]>;
  takeRelook: (busyIds: readonly string[], limit: number) => Promise<{ id: string; company?: string; title?: string }[]>;
  noteHidden: (ids: readonly string[]) => Promise<void>;
  notePassed: (rows: readonly { id: string; reason: string; company: string; title: string }[]) => Promise<void>;
  coveredWaiters: (queue: QueueRow[], ids: string[]) => string[];
  forgetLinks: (ids: readonly string[]) => Promise<void>;
  dropWaiters: (ids: readonly string[]) => Promise<void>;
  applyOutcomes: (rows: { id: string; outcome: 'invitation' | 'discard' | 'response'; at: number }[]) => Promise<void>;
  readMemory: () => Promise<unknown>;
  dayOpen: (memory: never) => boolean;
  readAccount: (login: string) => Promise<unknown>;
  weekOpen: (login: string, account: never) => boolean; // lib/server/week.ts
  notify?: (login: string, text: string) => Promise<void>; // optional existing notification channel
}

export type StoreDeps = Required<Pick<Deps, 'fetchLinks' | 'claimRelook' | 'postHidden' | 'onInvitation' | 'quota' | 'coverLetter'>>;

const BUSY = new Set(['pending', 'sent', 'needsHuman']);
const LINKS_READ = 40;
const LINKS_TAKE = 10;

export function planStoreDeps(io: StoreIO): StoreDeps {
  const t = <T>(login: string, job: () => Promise<T>) => io.inTenant(login, job);
  return {
    // GET /api/queue keptLinks: readLinks(40).slice(0, 10)
    fetchLinks: login => t(login, async (): Promise<Item[]> => {
      const rows = await io.readLinks(LINKS_READ);
      return rows.slice(0, LINKS_TAKE).filter(r => /^\d+$/.test(r.id)).map(r => ({ id: r.id, url: r.url || `https://hh.ru/vacancy/${r.id}`, title: r.title || r.id }));
    }),
    // POST /api/queue { relook: 1 }
    claimRelook: login => t(login, async (): Promise<Item[]> => {
      const busy = (await io.readQueue()).filter(r => BUSY.has(r.status)).map(r => r.id);
      const rows = await io.takeRelook(busy, 1);
      return rows.map(r => ({ id: r.id, title: r.title ?? r.id, company: r.company, url: `https://hh.ru/vacancy/${r.id}` }));
    }),
    // POST /api/queue { hidden: [...] }
    postHidden: (login, row) => t(login, async () => {
      await io.noteHidden([row.id]);
      const busy = new Set((await io.readQueue()).filter(r => BUSY.has(r.status)).map(r => r.id));
      if (!busy.has(row.id))
        await io.notePassed([{ id: row.id, reason: row.reason, company: '', title: row.title }]);
      const ids = io.coveredWaiters(await io.readQueue(), [row.id]);
      if (ids.length > 0) { await io.forgetLinks(ids); await io.dropWaiters(ids); }
    }),
    // same storage as /api/negotiations + optional notify; no message to the employer.
    onInvitation: (login, row: NegotiationRow) => t(login, async () => {
      await io.applyOutcomes([{ id: row.vacancyId, outcome: 'invitation', at: row.updatedAt || Date.now() }]);
      await io.notify?.(login, `Приглашение: ${row.title || row.vacancyId}${row.employer ? ` (${row.employer})` : ''} ${row.url}`);
    }),
    // GET /api/queue gate: day = dayOpen(memory), week = weekOpen(login, account)
    quota: login => t(login, async () => {
      const [memory, account] = await Promise.all([io.readMemory(), io.readAccount(login)]);
      return { day: io.dayOpen(memory as never), week: io.weekOpen(login, account as never) };
    }),
    // letter is transit from the extension safe (stage E); server never stores it.
    coverLetter: async () => '',
  };
}

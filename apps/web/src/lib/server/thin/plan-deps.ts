// Production wiring of planner dependencies onto existing server code. Every call runs in the account's own
// tenant (same runTenant as hooks.server.ts) so one login never touches another's data.
// Personal data: context is built per call from the account (transit), nothing is stored by the planner.
import type { Deps, Item, Settings } from '../plan/types.ts';
import type { NegotiationRow } from '../plan/negotiations.ts';

import { applyOutcomes, askChain, chainFromEnv, coveredWaiters, dayOpen, dropWaiters, forgetLinks, knownAmong, markDone, markSent, noteHidden, notePassed, restoreWaiter, saveWaiterForm, asCapturedForm, readDecisions, takeDecision, parseFacts, listCanon, listMemory, parseProfile, readLinks, readMemory, readQueue, remember, runTenant, takeRelook } from '@cursor-chrome/hh';
import { planStoreDeps } from '../plan/deps-impl.ts';
import type { StoreIO } from '../plan/deps-impl.ts';
import { weekOpen } from '../week';
import { createPlanFlags } from './plan-flags.ts';
import { chainOf, readAccount } from '../secrets';
import { serverChainFor } from '../demo';
import { completion, thinAnswer } from './answer-api';

type ProdDeps = Omit<Deps, 'enqueue'> & { onNegotiationRows?: (login: string, rows: NegotiationRow[]) => Promise<void> };

// existing /api/queue + /api/negotiations storage for planStoreDeps (Бекенд 2, plan/deps-impl.ts)
const storeIO: StoreIO = {
  inTenant: (login, job) => runTenant(login, job),
  readLinks: limit => readLinks(limit) as never,
  readQueue: () => readQueue() as never,
  takeRelook: (busy, limit) => takeRelook(busy as string[], limit) as never,
  noteHidden: ids => noteHidden([...ids]) as never,
  notePassed: rows => notePassed([...rows] as never) as never,
  coveredWaiters: (queue, ids) => coveredWaiters(queue as never, ids),
  forgetLinks: ids => forgetLinks([...ids]) as never,
  dropWaiters: ids => dropWaiters([...ids]) as never,
  applyOutcomes: rows => applyOutcomes(rows) as never,
  readMemory: () => readMemory(),
  dayOpen: memory => dayOpen(memory),
  readAccount: login => readAccount(login),
  weekOpen: (login, account) => weekOpen(login, account),
};

export function planDeps(headersOf: (login: string) => Headers, flags: { scenarios: (login: string) => Settings['scenarios'] } = defaultFlags()): ProdDeps {
  const inTenant = <T>(login: string, job: () => Promise<T>) => runTenant(login, job);

  return {
    ...planStoreDeps(storeIO),
    reviewItems: login => inTenant(login, async () => {
      const approved = new Set((await readDecisions()).filter(d=>d.action==='approved').map(d=>d.id));
      return (await readQueue()).filter(r=>r.status==='needsHuman' && approved.has(r.id)).map(r=>({id:r.id,title:r.title,url:r.url,company:r.company}));
    }),
    reviewAnswers: (login,id) => inTenant(login, async () => (await readDecisions()).find(d=>d.id===id && d.action==='approved')?.answers || []),
    captureForm: (login,item,fields,text) => inTenant(login,async()=>{
      const form=asCapturedForm({url:item.url,at:Date.now(),text,questions:(fields as any[]).map(f=>({prompt:f.prompt || f.label,kind:f.kind==='select' ? 'choice' : f.kind,options:f.options,required:f.required,fieldKey:f.id}))});
      if (form) await saveWaiterForm(item.id,form);
    }),
    coverLetter: login => inTenant(login, async () => (await readAccount(login)).coverLetter),
    // existing thin /api/answer engine; BYOK only from the headers of the extension's own request
    answer: (login, body) => inTenant(login, async () => {
      const account = await readAccount(login);
      const env = serverChainFor(login, chainFromEnv());
      const ours = env.length > 0 ? env : chainOf(account);
      const out = await thinAnswer(headersOf(login), body, ours, {
        complete: (provider, prompt) => completion(provider, prompt, { timeoutMs: 20_000 }),
        askChain: async (chain, prompt) => (await askChain(chain, prompt, 20_000)).text,
      });
      return { answers: out.answers };
    }),
    // transit: the account's own facts for this one answer, never copied into planner state
    context: login => inTenant(login, async () => { const account = await readAccount(login);
      return { profile: parseProfile(account.profile), coverLetter: account.coverLetter, facts: parseFacts(account.facts).rules, rules: await listCanon(), memory: await listMemory() }; }),
    // same storage as /api/applied: queue row + seen
    recordApplied: (login, row) => inTenant(login, async () => {
      if (row.status === 'sent' || row.status === 'needsHuman') {
        await restoreWaiter({...row,company:'',at:Date.now(),status:row.status});
        if ((await readDecisions()).some(d=>d.id===row.id && d.action==='approved')) await takeDecision(row.id);
      }

      if (row.status === 'sent' || row.status === 'needsHuman')
        await markDone(row.id, row.status, row.reason ? [row.reason] : []);

      if (row.status === 'sent')
        await markSent(row.id);
      else
        await remember([row.id]);
    }),
    // same «known» check as /api/found
    filterKnown: (login, cards: Item[]) => inTenant(login, async () => {
      const known = new Set(await knownAmong(cards.map(card => card.id)));
      return cards.filter(card => known.has(card.id) === false);
    }),
    // same storage as /api/negotiations
    onNegotiationRows: (login, rows) => inTenant(login, async () => {
      if (rows.length === 0)
        return;

      await remember([...new Set(rows.map(row => row.vacancyId))]);
      await applyOutcomes(rows.map(row => ({ id: row.vacancyId, outcome: row.state, at: row.updatedAt || Date.now() })));
    }),
    // admin settings of the account
    settings: login => inTenant(login, async (): Promise<Settings> => {
      const account = await readAccount(login);
      const words = account.hhQuery.split(/[,\n]/).map(word => word.trim()).filter(Boolean);
      // scenarios from plan-flags: all off until switched on per account
      return { keepWorkHours: account.hhHours !== '0', scenarios: flags.scenarios(login), pace: account.imitation, ...(words.length > 0 ? { words } : {}) };
    }),
  };
}

let flagsSingleton: ReturnType<typeof createPlanFlags> | null = null;
function defaultFlags() {
  flagsSingleton ??= createPlanFlags();
  return flagsSingleton;
}

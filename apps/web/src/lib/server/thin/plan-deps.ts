// Production wiring of planner dependencies onto existing server code. Every call runs in the account's own
// tenant (same runTenant as hooks.server.ts) so one login never touches another's data.
// Personal data: context is built per call from the account (transit), nothing is stored by the planner.
import type { Deps, Item, Settings } from '../plan/types.ts';
import type { NegotiationRow } from '../plan/negotiations.ts';

import { applyOutcomes, askChain, chainFromEnv, knownAmong, markDone, markSent, parseFacts, remember, runTenant } from '@cursor-chrome/hh';
import { chainOf, readAccount } from '../secrets';
import { serverChainFor } from '../demo';
import { completion, thinAnswer } from './answer-api';

type ProdDeps = Omit<Deps, 'enqueue'> & { onNegotiationRows?: (login: string, rows: NegotiationRow[]) => Promise<void> };

export function planDeps(headersOf: (login: string) => Headers): ProdDeps {
  const inTenant = <T>(login: string, job: () => Promise<T>) => runTenant(login, job);

  return {
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
    context: login => inTenant(login, async () => ({ facts: parseFacts((await readAccount(login)).facts).rules })),
    // same storage as /api/applied: queue row + seen
    recordApplied: (login, row) => inTenant(login, async () => {
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
      return { keepWorkHours: account.hhHours !== '0', ...(words.length > 0 ? { words } : {}) };
    }),
  };
}

import type { Deps, Step } from '../plan/types.ts';
import type { PlanFlags } from './plan-flags.ts';
import type { Wire } from './cmd-bus.ts';

import { primitivePlanner } from '../plan/primitive-plan.ts';
import { createPlanner, createStore } from '../plan/index.ts';
import { bus as defaultBus } from './cmd-bus.ts';

type Bus = typeof defaultBus;
export type Pause = { type: 'idle'; reason: string; retryMs: number } | { type: 'stop'; reason: string; needsHuman: boolean };
export const OFF_AFTER_MS = 15 * 60_000; // flag off: answer at once, client comes back in 15 min
export type NextAnswer = { kind: 'off'; afterMs: number } | { kind: 'old' } | { kind: 'cmd'; cmd: Wire | null } | { kind: 'pause'; pause: Pause };

const KEY_HEADERS = ['x-llm-key', 'x-llm-provider', 'x-llm-model'];

export function createPlanLink(o: { flags: Pick<PlanFlags, 'enabled'>; deps: (headersOf: (login: string) => Headers) => Omit<Deps, 'enqueue'>; primitiveOnly?: boolean; bus?: Bus; now?: () => number }) {
  const bus = o.bus ?? defaultBus;
  const now = o.now ?? Date.now;
  const heads = new Map<string, Headers>();
  const runs = new Map<string,string>();
  const pauses = new Map<string, { until: number; pause: Pause }>();
  const headersOf = (login: string) => heads.get(login) ?? new Headers();
  const mem = createStore();
  const store = { ...mem, enabled: (login: string) => o.flags.enabled(login) };
  const planner = createPlanner(store, { ...o.deps(headersOf), enqueue: o.primitiveOnly ? primitivePlanner(bus.enqueue) : bus.enqueue, now });

  const asPause = (step: Step): Pause | null => step.type === 'idle' ? { type: 'idle', reason: step.reason, retryMs: step.retryMs } : step.type === 'stop' ? { type: 'stop', reason: step.reason, needsHuman: step.needsHuman } : null;

  async function onNext(login: string, request: Request, waitMs?: number): Promise<NextAnswer> {
    if (o.flags.enabled(login) === false) {
      heads.delete(login);
      pauses.delete(login);

      return { kind: 'off', afterMs: OFF_AFTER_MS };
    }

    if (request.headers.get('x-ext-enabled') === 'false') return {kind:'pause', pause:{type:'idle',reason:'выключено',retryMs:900000}};

    const epoch = request.headers.get('x-ext-run');
    if(epoch && epoch!==runs.get(login)) {runs.set(login,epoch);store.release(login);pauses.delete(login);}
    const held = pauses.get(login);
    if (held && now() < held.until)
      return { kind: 'pause', pause: held.pause.type === 'idle' ? { ...held.pause, retryMs: held.until - now() } : held.pause };

    pauses.delete(login);
    const keep = new Headers();
    for (const name of KEY_HEADERS) {
      const value = request.headers.get(name);
      if (value)
        keep.set(name, value);
    }

    heads.set(login, keep);
    const run = planner.kick(login);
    if (run === null)
      return { kind: 'old' };

    const stop = new AbortController();
    const onAbort = () => stop.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    const ended = run.then((r) => {
      heads.delete(login);
      const pause = asPause(r.last);
      if (pause) {
        pauses.set(login, { until: now() + (pause.type === 'idle' ? pause.retryMs : 15 * 60_000), pause });
        stop.abort();
      }
      return pause;
    }, () => {
      heads.delete(login);
      return null;
    });
    try {
      const cmd = await bus.next(login, stop.signal, waitMs);
      if (cmd !== null)
        return { kind: 'cmd', cmd };

      const pause = await Promise.race([ended, Promise.resolve(null)]);
      const p = pause ?? pauses.get(login)?.pause ?? null;

      return p ? { kind: 'pause', pause: p } : { kind: 'cmd', cmd: null };
    }
    finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  return { onNext, planner, store };
}
export type PlanLink = ReturnType<typeof createPlanLink>;

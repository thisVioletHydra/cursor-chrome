// Entry point. Chosen launch mode: a finite async chain started from the extension's request
// (next/report). Each command awaits its own report; the chain ends on idle/stop or after maxSteps,
// so nothing runs on the server when the extension is silent. One chain per login at a time.
import type { Deps, Outcome, Step } from './types.ts';
import type { Store } from './state.ts';
import { advance } from './machine.ts';

export interface RunResult { steps: number; last: Step }

export function createPlanner(store: Store, deps: Deps) {
  const running = new Map<string, Promise<RunResult>>();

  async function chain(login: string, maxSteps: number): Promise<RunResult> {
    const st = store.get(login, (deps.now ?? Date.now)());
    let last: Outcome | undefined;
    let step: Step = { type: 'idle', reason: 'нет шагов', retryMs: 1000 };
    let n = 0;
    while (n < maxSteps) {
      step = await advance(st, last, deps);
      if (step.type !== 'cmd') break;
      n++;
      try { last = await deps.enqueue(login, step.cmd, step.execMs ? { execMs: step.execMs } : undefined); }
      catch (e) { last = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    }
    return { steps: n, last: step };
  }

  return {
    // Call from /api/ext/next (or report) handlers. Returns null when the flag is off → old logic.
    kick(login: string, maxSteps = 50): Promise<RunResult> | null {
      if (!login || store.enabled(login) === false) return null;
      const cur = running.get(login);
      if (cur) return cur;
      const p = chain(login, maxSteps).finally(() => running.delete(login));
      running.set(login, p);
      return p;
    },
    running: (login: string) => running.has(login),
    status(login: string) {
      const st = store.get(login, (deps.now ?? Date.now)());
      return { enabled: store.enabled(login), phase: st.phase, queued: st.queue.length, sentToday: st.sentToday, hold: st.hold };
    },
  };
}

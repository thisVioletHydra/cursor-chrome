// Growing retry intervals instead of tight loops: no link / 401 / dead server / no local bridge.
// Server probe: 30 s → 1 → 2 → 4 → 8 → 15 min (cap). Local Cursor bridge (ws/native 127.0.0.1:18765): 2 s … 15 min.
// A user action («Подключить», popup open) probes at once and resets the counter.
export const SERVER_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000] as const;
export const BRIDGE_STEPS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 900_000] as const;
export const MAX_STEP_MS = 900_000;

export function stepAt(steps: readonly number[], fails: number): number {
  if (fails <= 0)
    return 0;

  return steps[Math.min(fails - 1, steps.length - 1)] ?? MAX_STEP_MS;
}

export type Backoff = { next: () => number; reset: () => void; fails: () => number };

// next(): delay before the next attempt after one more failure (first failure → steps[0]).
export function makeBackoff(steps: readonly number[]): Backoff {
  let count = 0;

  return {
    next: () => {
      count += 1;

      return stepAt(steps, count);
    },
    reset: () => {
      count = 0;
    },
    fails: () => count,
  };
}

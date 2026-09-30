import type { Memory } from '../diary/memory.ts';
import type { State } from '../diary/state.ts';

import { QUEUE_TARGET, SCAN_EVERY_MS } from '../limits.ts';
import { dayOpen, workHours } from '../diary/memory.ts';

export type TickInput = {
  state: State;
  memory: Memory;
  pendingCount: number;
  scanning: boolean;
  now?: Date;
};

export function scanBlock(input: TickInput): string | null {
  if (input.state.auto === false)
    return 'автопилот выключен';

  if (input.scanning)
    return 'скан уже идёт';

  if (workHours(input.now) === false)
    return 'ночь, ждём 09:00 МСК';

  if (dayOpen(input.memory) === false)
    return 'потолок на сегодня';

  if (input.pendingCount >= QUEUE_TARGET)
    return `в очереди уже ${input.pendingCount}`;

  return null;
}

export function startTicker(tick: () => Promise<void>, everyMs = SCAN_EVERY_MS): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy)
      return;

    busy = true;
    void tick().catch((error) => {
      console.error(error instanceof Error ? error.message : 'tick');
    }).finally(() => {
      busy = false;
    });
  }, everyMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

import type { Pilot, PilotEvent } from '../chrome/pilot';

import { getFlags, setFlags } from './flags';
import { freshPilot, pilotStep } from '../chrome/pilot';
import { closePinnedHh } from '../tab/worker-tab';

export async function applyPilot(event: PilotEvent): Promise<Pilot> {
  const flags = await getFlags();
  const next = pilotStep({ ...freshPilot(), on: flags.autoQueue }, event);
  if (next.on !== flags.autoQueue) {
    const stored = await setFlags({ autoQueue: next.on });
    if (stored.autoQueue !== next.on)
      return { ...next, on: stored.autoQueue, closeBotTab: false };
  }

  if (next.closeBotTab)
    await closePinnedHh();

  return next;
}

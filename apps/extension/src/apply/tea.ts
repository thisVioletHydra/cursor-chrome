import { tickPage } from '../pilot/page-log';
import { budgetSec, waitMark } from '../pilot/wait-pulse';
import { waitMs } from './pace';
import { beatTea, doneTea, rollTea, swayMs } from './tea-clock';
import { browser } from '../browser-host';

export { markTeaWork, noteTeaSession } from './tea-clock';

const TEA_HIT = 0.33;
const TEA_MISS_MS = 15_000;
const TEA_MIN_SEC = 300;
const TEA_MAX_SEC = 600;

export async function maybeTea(): Promise<void> {
  const roll = await rollTea(() => {
    const hit = Math.random() < TEA_HIT;
    const pause = hit ? waitMs(TEA_MIN_SEC, TEA_MAX_SEC) : swayMs(TEA_MISS_MS);

    return { hit, pause };
  });
  if (roll === null)
    return;

  // Секундный пульс, иначе сторож решит, что бот завис.
  await tickPage(roll.hit ? 'чай' : 'жду', roll.pause, '', waitMark({
    id: roll.hit ? 'tea.break' : 'tea.miss',
    human: roll.hit ? 'чай' : 'чай мимо',
    budget: budgetSec(roll.pause),
    next: 'queue.next',
    hold: roll.hit === false,
  }));
  await doneTea(roll);
}

function inWorker(): boolean {
  return typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope;
}

// Попап не должен слушать keepalive: второй тик чая крутился бы, пока окно открыто.
if (inWorker()) {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'keepalive')
      return;

    port.onMessage.addListener(() => {
      void beatTea();
    });
  });
}

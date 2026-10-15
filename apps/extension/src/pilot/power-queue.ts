// Popup «Включить/Выключить»: a click while the previous toggle is still running is not lost. It flips the
// intent; when the running toggle ends, one more toggle runs (two quick clicks → on, then off).
export function makePowerQueue(run: () => Promise<void>): () => Promise<void> {
  let busy = false;
  let again = false;
  return async () => {
    if (busy) {
      again = !again;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    }
    finally {
      busy = false;
    }
  };
}

// Background: a user «off» that lands while the bot tab is being opened waits for it instead of being dropped.
export async function waitUntil(done: () => boolean, maxMs: number, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)), stepMs = 100): Promise<boolean> {
  for (let spent = 0; done() === false; spent += stepMs) {
    if (spent >= maxMs)
      return false;
    await sleep(stepMs);
  }
  return true;
}

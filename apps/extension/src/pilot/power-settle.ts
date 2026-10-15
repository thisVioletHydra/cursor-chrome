// Popup «Включить/Выключить»: the button settles as soon as storage confirms the target autoQueue value
// (or after a ~2 s safety timeout), not when the whole enable/stop message chain returns (that took > 8 s).
// Pure: storage access is injected (tested with fakes).
export const POWER_SETTLE_MS = 2_000;

export function settlePower(
  target: boolean,
  read: () => Promise<boolean>,
  subscribe: (changed: (value: boolean) => void) => () => void,
  timeoutMs = POWER_SETTLE_MS,
  timer: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done)
        return;

      done = true;
      timer.clear(id);
      stop();
      resolve(ok);
    };
    const id = timer.set(() => finish(false), timeoutMs);
    const stop = subscribe((value) => {
      if (value === target)
        finish(true);
    });
    void read().then((value) => {
      if (value === target)
        finish(true);
    }).catch(() => {});
  });
}

// last click wins: every click takes a new generation; only the newest one may paint the button
export function makeGeneration(): { next: () => number; current: () => number } {
  let gen = 0;

  return { next: () => ++gen, current: () => gen };
}

// Popup click burst → one wish: the button shows the wanted state at once; after POWER_DEBOUNCE_MS of quiet
// exactly one message goes out with a monotonic seq (Date-based, so a reopened popup is still newer).
export const POWER_DEBOUNCE_MS = 300;
export function makeWishSender(
  send: (on: boolean, seq: number) => void,
  timer: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) },
  now: () => number = Date.now,
  delayMs = POWER_DEBOUNCE_MS,
): { wish: (on: boolean) => number; pending: () => boolean } {
  let last = 0;
  let id: unknown = null;

  return {
    wish: (on) => {
      last = Math.max(now(), last + 1);
      const seq = last;
      if (id !== null)
        timer.clear(id);
      id = timer.set(() => {
        id = null;
        send(on, seq);
      }, delayMs);

      return seq;
    },
    pending: () => id !== null,
  };
}

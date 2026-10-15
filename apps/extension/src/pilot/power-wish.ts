// Autopilot on/off in the service worker: the popup sends ONE wish per (debounced) click burst with a monotonic seq.
// Only the newest seq may change autoQueue; the short decision step (guards + applyPilot) runs under a lock,
// so a slow older «enable» can never write true after a newer «stop». The long tail (open tab, push to the server)
// runs outside the lock and checks staleness first, so «off» lands within the lock wait, not after the 8 s tail.
export type PowerGate = {
  // false → an older (or duplicate) wish: ignore it
  accept: (seq: number | undefined) => boolean;
  stale: (seq: number | undefined) => boolean;
  locked: <T>(run: () => Promise<T>) => Promise<T>;
  latest: () => number;
};

export function makePowerGate(): PowerGate {
  let last = 0;
  let tail: Promise<unknown> = Promise.resolve();

  return {
    accept: (seq) => {
      if (typeof seq !== 'number' || Number.isFinite(seq) === false)
        return true; // old callers without seq: unordered as before
      if (seq <= last)
        return false;

      last = seq;

      return true;
    },
    stale: seq => typeof seq === 'number' && seq < last,
    locked: (run) => {
      const next = tail.then(run, run);
      tail = next.catch(() => {});

      return next;
    },
    latest: () => last,
  };
}

// The newest user wish (on/off), set synchronously when set-flags accepts it. While it is «off»,
// no writer (server pulse, pair/heal, touch, an older enable tail) may store autoQueue=true.
// null = the user has not clicked since the worker started (pilot-stop in storage still guards restarts).
let userWish: boolean | null = null;

export function noteUserWish(on: boolean): void {
  userWish = on;
}

export function userWishOff(): boolean {
  return userWish === false;
}

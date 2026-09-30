export const PAGE_LOAD_MS = 45_000;

export function pageLoadMiss(waitedMs: number): boolean {
  if (Number.isFinite(waitedMs) === false)
    return true;

  return waitedMs > PAGE_LOAD_MS;
}

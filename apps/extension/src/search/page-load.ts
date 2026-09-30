export const PAGE_LOAD_MS = 45_000;
export const FLIP_MIN_MS = 2_000;
export const FLIP_MAX_MS = 4_000;

const TICK = /^(читаю|быстро|чай|отвлёкся|жду) \d+$/;
const SEARCH_TICK = /^ищу вакансию, \d+ с$/;
const PAGE_TICK = /^жду страницу, \d+ с$/;

export type PageStep = 'saved' | 'more' | 'end';

export function pageLoadMiss(waitedMs: number): boolean {
  if (Number.isFinite(waitedMs) === false)
    return true;

  return waitedMs > PAGE_LOAD_MS;
}

export function flipWaitMs(roll: number): number {
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;

  return FLIP_MIN_MS + Math.floor(unit * (FLIP_MAX_MS - FLIP_MIN_MS));
}

export function searchStep(input: { saved: number; hasNext: boolean }): PageStep {
  if (input.saved > 0)
    return 'saved';

  if (input.hasNext)
    return 'more';

  return 'end';
}

export function liveTick(text: string): boolean {
  return text === 'ищу вакансию' || TICK.test(text) || SEARCH_TICK.test(text) || PAGE_TICK.test(text);
}

export function foldLiveLine(lines: readonly string[], text: string): string[] {
  const next = lines.slice();
  const previous = next[next.length - 1] ?? '';
  if (previous === text)
    return next;

  if (next.length > 0 && liveTick(previous) && liveTick(text)) {
    next[next.length - 1] = text;

    return next;
  }

  next.push(text);

  return next;
}

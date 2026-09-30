export type WaitKind = 'w' | 's' | 'p';

export type WaitMark = {
  id: string;
  human: string;
  budget: number | null;
  next: string;
  kind: WaitKind;
  hold: boolean;
};

export type WaitPulse = {
  id: string;
  human: string;
  budget: number | null;
  elapsed: number;
  next: string;
  kind: WaitKind;
  hold: boolean;
};

const PULSE = /^~([a-z][a-z0-9.]*)\|([^|]+)\|(-|\d+)\|(\d+)\|([a-z][a-z0-9.]*)\|([wsp])\|([01])$/;

export function waitMark(mark: {
  id: string;
  human: string;
  budget: number | null;
  next: string;
  kind?: WaitKind;
  hold?: boolean;
}): WaitMark {
  return {
    id: mark.id,
    human: mark.human,
    budget: mark.budget,
    next: mark.next,
    kind: mark.kind ?? 'w',
    hold: mark.hold === true,
  };
}

export function budgetSec(ms: number): number {
  if (Number.isFinite(ms) === false)
    return 0;

  return Math.max(0, Math.round(ms / 1000));
}

export function waitPulse(mark: WaitMark, elapsed: number): string {
  const budget = mark.budget === null ? '-' : String(Math.max(0, Math.round(mark.budget)));
  const sec = Number.isFinite(elapsed) ? Math.max(0, Math.trunc(elapsed)) : 0;
  const hold = mark.hold ? '1' : '0';

  return `~${mark.id}|${mark.human}|${budget}|${sec}|${mark.next}|${mark.kind}|${hold}`;
}

export function readWaitPulse(text: string): WaitPulse | null {
  const hit = PULSE.exec(text);
  if (hit === null)
    return null;

  const kind = hit[6];
  if (kind !== 'w' && kind !== 's' && kind !== 'p')
    return null;

  const id = hit[1] ?? '';
  const human = hit[2] ?? '';
  const next = hit[5] ?? '';
  if (id.length === 0 || human.length === 0 || next.length === 0)
    return null;

  const rolled = hit[3] === '-' ? null : Number(hit[3]);
  const elapsed = Number(hit[4]);
  if (rolled !== null && Number.isInteger(rolled) === false)
    return null;

  if (Number.isInteger(elapsed) === false)
    return null;

  return {
    id,
    human,
    budget: rolled,
    elapsed,
    next,
    kind,
    hold: hit[7] === '1',
  };
}

export function liveState(text: string): boolean {
  return readWaitPulse(text) !== null;
}

export function pulseHolds(text: string): boolean {
  return readWaitPulse(text)?.hold === true;
}

export function pulseLines(text: string): string[] | null {
  const hit = readWaitPulse(text);
  if (hit === null)
    return null;

  return [
    hit.id,
    hit.human,
    hit.budget === null ? 'без жребия' : `жребий: ${hit.budget} с`,
    `прошло: ${hit.elapsed} с`,
    `дальше: ${hit.next}`,
  ];
}

export type WalkPhase = 'cover' | 'deep';

export type Walk = {
  phase: WalkPhase;
  at: number;
  left: number;
};

export function freshWalk(): Walk {
  return { phase: 'cover', at: 0, left: 1 };
}

export function burstPages(phase: WalkPhase, roll: number): number {
  if (phase === 'cover')
    return 1;

  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;

  return unit < 0.5 ? 2 : 3;
}

export function walkFrom(raw: { walkPhase?: unknown; walkAt?: unknown; walkLeft?: unknown }): Walk {
  const phase: WalkPhase = raw.walkPhase === 'deep' ? 'deep' : 'cover';
  const at = whole(raw.walkAt);
  const left = whole(raw.walkLeft);
  if (phase === 'cover')
    return { phase, at, left: 1 };

  if (left >= 1 && left <= 3)
    return { phase, at, left };

  return { phase, at, left: 2 };
}

export function stepWalk(walk: Walk, count: number, read: number, done: boolean, roll: number): Walk {
  if (count <= 0)
    return freshWalk();

  const at = walk.at < count ? walk.at : 0;
  const current = at === walk.at ? walk : { ...walk, at };
  const seen = whole(read);
  if (done || seen >= current.left)
    return nextWord(current, count, roll);

  if (seen === 0)
    return current;

  return { ...current, left: current.left - seen };
}

function nextWord(walk: Walk, count: number, roll: number): Walk {
  const at = walk.at + 1;
  if (at >= count)
    return { phase: 'deep', at: 0, left: burstPages('deep', roll) };

  if (walk.phase === 'cover')
    return { phase: 'cover', at, left: 1 };

  return { phase: 'deep', at, left: burstPages('deep', roll) };
}

function whole(value: unknown): number {
  if (typeof value !== 'number' || Number.isFinite(value) === false || value <= 0)
    return 0;

  return Math.floor(value);
}

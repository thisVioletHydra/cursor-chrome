export type LogRow = {
  at: number;
  who: string;
  text: string;
  death: boolean;
};

export const logSnap = $state({
  rows: [] as LogRow[],
  pulse: '',
});

export const logPlace = {
  follow: true,
  scrollTop: 0,
  anchorKey: '',
  anchorDelta: 0,
};

export function logKey(row: LogRow): string {
  return `${row.at}:${row.who}:${row.text}`;
}

export function readLog(value: unknown): LogRow[] {
  if (Array.isArray(value) === false)
    return [];

  return value.flatMap(rowOf);
}

export function takeRows(incoming: LogRow[]): { dropped: number; changed: boolean } {
  const rows = logSnap.rows;
  const have = new Map<string, LogRow>();
  for (const row of rows)
    have.set(logKey(row), row);

  const next = incoming.map(row => have.get(logKey(row)) ?? row);
  if (sameRows(rows, next))
    return { dropped: 0, changed: false };

  const keep = new Set(next);
  let dropped = 0;
  while (dropped < rows.length && keep.has(rows[dropped]) === false)
    dropped += 1;

  if (dropped > 0)
    rows.splice(0, dropped);

  let index = 0;
  while (index < rows.length && index < next.length && rows[index] === next[index])
    index += 1;

  if (index < rows.length)
    rows.splice(index);

  for (let cursor = rows.length; cursor < next.length; cursor += 1)
    rows.push(next[cursor]);

  return { dropped, changed: true };
}

function sameRows(rows: LogRow[], next: LogRow[]): boolean {
  if (rows.length !== next.length)
    return false;

  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index] !== next[index])
      return false;
  }

  return true;
}

function rowOf(value: unknown): LogRow[] {
  if (typeof value !== 'object' || value === null)
    return [];

  if ('at' in value === false || typeof value.at !== 'number')
    return [];

  if ('who' in value === false || typeof value.who !== 'string')
    return [];

  if ('text' in value === false || typeof value.text !== 'string')
    return [];

  if ('death' in value === false || (value.death !== true && value.death !== false))
    return [];

  return [{ at: value.at, who: value.who, text: value.text, death: value.death }];
}

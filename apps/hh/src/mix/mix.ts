export type Taste = 'front' | 'less' | 'out';

export type Slot = 'front' | 'less';

export type Buckets<T> = {
  front: T[];
  less: T[];
  rest: T[];
};

export type QueryCursor = {
  frontAt: number;
  lessAt: number;
  queryPass: number;
};

export const FRONT_TAKE = 3;
export const LESS_TAKE = 2;

const LESS = /(?:^|[^\p{L}\p{N}])(?:backend|back\s*end|бэкенд|бекенд|fullstack|full\s*stack|фул+ст[еэ]к|node(?:\s*js)?|nest(?:\s*js)?|php|python|java|express)(?=$|[^\p{L}\p{N}])/iu;
const FRONT = /(?:^|[^\p{L}\p{N}])(?:frontend|front\s*end|фронтенд|фронтэнд|vue|react)(?=$|[^\p{L}\p{N}])/iu;
const SCRIPT = /(?:^|[^\p{L}\p{N}])(?:javascript|typescript)(?=$|[^\p{L}\p{N}])/iu;
const JUNK = /(?:^|[^\p{L}\p{N}])(?:qa|aqa|manager|sourcer|analyst|support|саппорт)(?=$|[^\p{L}\p{N}])|(?:^|[^\p{L}\p{N}])(?:quality assurance|тестиров|менеджер|сорсер|аналитик|робототех|robotics|техподдерж)/iu;

export function roleJunk(title: string): boolean {
  return JUNK.test(fold(title));
}

export function taste(title: string, foundBy: string): Taste {
  if (roleJunk(title))
    return 'out';

  if (lessHit(title) || lessHit(foundBy))
    return 'less';

  if (frontHit(title) || frontHit(foundBy))
    return 'front';

  if (scriptHit(title) || scriptHit(foundBy))
    return 'front';

  return 'out';
}

export function takeSlot<T>(buckets: Buckets<T>, prefer: Slot): T | undefined {
  const order = prefer === 'front'
    ? [buckets.front, buckets.less, buckets.rest]
    : [buckets.less, buckets.front, buckets.rest];

  for (const list of order) {
    const item = list.shift();
    if (item !== undefined)
      return item;
  }

  return undefined;
}

export function hasSlot<T>(buckets: Buckets<T>): boolean {
  return buckets.front.length > 0 || buckets.less.length > 0 || buckets.rest.length > 0;
}

export function stepSlot(prefer: Slot, left: number): { prefer: Slot; left: number } {
  if (left > 1)
    return { prefer, left: left - 1 };

  if (prefer === 'front')
    return { prefer: 'less', left: LESS_TAKE };

  return { prefer: 'front', left: FRONT_TAKE };
}

export function mixBatch<T>(items: readonly T[], tasteOf: (item: T) => Taste): T[] {
  const buckets: Buckets<T> = {
    front: items.filter(item => tasteOf(item) === 'front'),
    less: items.filter(item => tasteOf(item) === 'less'),
    rest: items.filter(item => tasteOf(item) === 'out'),
  };
  const ordered: T[] = [];
  let prefer: Slot = 'front';
  let left = FRONT_TAKE;

  while (hasSlot(buckets)) {
    const item = takeSlot(buckets, prefer);
    if (item === undefined)
      break;

    ordered.push(item);
    const step = stepSlot(prefer, left);
    prefer = step.prefer;
    left = step.left;
  }

  return ordered;
}

// Один цикл ходит по текущему срезу 3+2. Следующий срез только по явной просьбе, не по таймеру.
export function serveQueries(queries: readonly string[], cursor: QueryCursor, advance = false): { queries: string[]; cursor: QueryCursor } {
  if (advance === false) {
    const shown = sliceQueries(queries, cursor.frontAt, cursor.lessAt);
    if (cursor.queryPass >= 0)
      return { queries: shown.queries, cursor };

    return {
      queries: shown.queries,
      cursor: { frontAt: cursor.frontAt, lessAt: cursor.lessAt, queryPass: 0 },
    };
  }

  const skipped = cursor.queryPass < 0
    ? { frontAt: cursor.frontAt, lessAt: cursor.lessAt }
    : sliceQueries(queries, cursor.frontAt, cursor.lessAt);

  return {
    queries: sliceQueries(queries, skipped.frontAt, skipped.lessAt).queries,
    cursor: { frontAt: skipped.frontAt, lessAt: skipped.lessAt, queryPass: cursor.queryPass + 1 },
  };
}

function sliceQueries(queries: readonly string[], frontAt: number, lessAt: number): { queries: string[]; frontAt: number; lessAt: number } {
  const front = queries.filter(query => lessHit(query) === false);
  const less = queries.filter(query => lessHit(query));
  const used = new Set<string>();
  const picked: string[] = [];
  let f = frontAt;
  let l = lessAt;

  const takeFrom = (side: Slot): string | null => {
    const bucket = side === 'front' ? front : less;
    const at = side === 'front' ? f : l;
    const hit = unused(bucket, at, used);
    if (hit === null)
      return null;

    used.add(hit.query);
    if (side === 'front')
      f = hit.at;
    else
      l = hit.at;

    return hit.query;
  };

  const pull = (prefer: Slot): boolean => {
    const query = takeFrom(prefer) ?? takeFrom(prefer === 'front' ? 'less' : 'front');
    if (query === null)
      return false;

    picked.push(query);

    return true;
  };

  for (let n = 0; n < FRONT_TAKE; n += 1) {
    if (pull('front') === false)
      break;
  }

  for (let n = 0; n < LESS_TAKE; n += 1) {
    if (pull('less') === false)
      break;
  }

  return { queries: picked, frontAt: f, lessAt: l };
}

function unused(bucket: string[], at: number, used: Set<string>): { query: string; at: number } | null {
  if (bucket.length === 0)
    return null;

  for (let step = 0; step < bucket.length; step += 1) {
    const index = positiveMod(at + step, bucket.length);
    const query = bucket[index];
    if (query === undefined || used.has(query))
      continue;

    return { query, at: index + 1 };
  }

  return null;
}

function positiveMod(value: number, size: number): number {
  if (size === 0)
    return 0;

  return ((value % size) + size) % size;
}

function lessHit(text: string): boolean {
  return LESS.test(fold(text));
}

function frontHit(text: string): boolean {
  return FRONT.test(fold(text));
}

function scriptHit(text: string): boolean {
  return SCRIPT.test(fold(text));
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.\-_/+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

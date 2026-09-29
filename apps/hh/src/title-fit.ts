const KNOWN: Record<string, string[]> = {
  frontend: ['frontend', 'фронтенд', 'фронтэнд'],
  vuejs: ['vue'],
  typescript: ['typescript'],
  javascript: ['javascript'],
  nodejs: ['nodejs', 'node'],
  fullstack: ['fullstack', 'фулстек', 'фуллстек', 'фулстэк'],
  nestjs: ['nestjs'],
  graphql: ['graphql'],
};

export function fitsTitle(title: string, queries: string[]): boolean {
  const hay = fold(title);

  return queries.some(query => queryFits(hay, query));
}

function queryFits(hay: string, query: string): boolean {
  const glued = fold(query).replace(/ /g, '');
  if (glued.length === 0)
    return false;

  const needles = KNOWN[glued] ?? [glued];

  return needles.some(needle => hasWord(hay, needle));
}

function hasWord(hay: string, needle: string): boolean {
  if (bounded(hay, needle))
    return true;

  const gluedNeedle = needle.replace(/ /g, '');
  if (gluedNeedle.length < 4)
    return false;

  return hay.replace(/ /g, '').includes(gluedNeedle);
}

function bounded(hay: string, needle: string): boolean {
  if (needle.length === 0)
    return false;

  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(needle)}`, 'iu').test(hay);
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.\-_/+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

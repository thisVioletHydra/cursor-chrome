// Short demo-account name for the sidebar: never cut with an ellipsis.
// Fits as is when <= max chars; otherwise «first word + first 3 letters of the second» («Vasya Pupkin» → «Vasya Pup»);
// a single long word is cut to max chars. Deterministic, no «…».
export const DEMO_NAME_MAX = 10;

export function shortDemoName(name: string | null | undefined, login = '', max = DEMO_NAME_MAX): string {
  const full = (name ?? '').trim().replace(/\s+/g, ' ') || login.trim();
  if (full.length <= max)
    return full;
  const [first, second] = full.split(/[\s_-]+/);
  if (second)
    return `${first.slice(0, max)} ${second.slice(0, 3)}`;
  return first.slice(0, max);
}
